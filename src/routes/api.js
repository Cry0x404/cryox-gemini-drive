import express from 'express';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  fetchGeminiUploadedHandle,
  hasGeminiSession,
  reloadGeminiSession,
  uploadGeminiIncomingStream,
  warmupGemini,
} from '../../lib/gemini-web.js';
import { isVaultFormat, openVaultPayload, sealVaultPayload, VAULT_FORMAT } from '../../lib/vault-envelope.js';
import { getGeminiSessionStatus } from '../../lib/session-store.js';
import { config } from '../config.js';
import { contentDisposition, decodeHeader, requireUuid, safeName, safeType } from '../http/validation.js';
import {
  hasVaultCache,
  loadHiddenIds,
  loadIndex,
  loadState,
  readVaultCache,
  removeVaultCache,
  saveHiddenIds,
  saveIndex,
  saveState,
  writeVaultCache,
} from '../store/vault-store.js';
import {
  attachRecordToVault,
  findPersistedRecord,
  resolveHistoryDownloadUrl,
  syncVaultRecordsFromGemini,
} from '../services/history.js';
import { safeGoogleDownloadUrl } from '../services/provider-urls.js';

const router = express.Router();

function publicRecord(row) {
  return {
    id: row.id,
    name: row.name,
    size: Math.max(0, Number(row.size) || 0),
    type: row.type || 'application/octet-stream',
    uploadedAt: Number(row.uploadedAt) || 0,
    conversationId: row.conversationId || '',
    downloadReady: hasVaultCache(row.id) || Boolean(safeGoogleDownloadUrl(row.remoteUrl) || safeGoogleDownloadUrl(row.handle)),
  };
}

async function readResponseBuffer(response) {
  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let total = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.length;
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

router.get('/status', async (_request, response) => {
  reloadGeminiSession();
  const state = loadState();
  const source = getGeminiSessionStatus();
  let live = false;
  let sessionError = source.error || '';

  if (hasGeminiSession()) {
    try {
      await warmupGemini();
      live = true;
    } catch (error) {
      live = false;
      sessionError = String(error?.message || 'Gemini session verification failed.').slice(0, 300);
    }
  }

  response.json({
    ok: true,
    configured: hasGeminiSession(),
    live,
    sessionSource: source.source,
    sessionError,
    conversationId: String(state.conversationId || ''),
    fileCount: loadIndex().length,
  });
});

router.get('/files', (_request, response) => {
  const files = loadIndex().map(publicRecord).sort((left, right) => right.uploadedAt - left.uploadedAt);
  return response.json({ files });
});

router.post('/sync', async (request, response) => {
  const force = String(request.query.force || '') === '1';
  let items = loadIndex();
  let discovery = null;

  if (hasGeminiSession()) {
    try {
      discovery = await syncVaultRecordsFromGemini({ force });
      items = discovery.files;
    } catch (error) {
      console.warn('[history-scan]', error?.kind || error?.name || 'error', error?.message || error);
      if (!items.length) return response.status(502).json({ error: error?.message || 'Gemini history could not be synchronized.' });
    }
  }

  return response.json({
    files: items.map(publicRecord).sort((left, right) => right.uploadedAt - left.uploadedAt),
    discovery: discovery
      ? { scanned: discovery.scanned, discovered: discovery.discovered, failed: discovery.failed }
      : null,
  });
});

router.post('/upload', async (request, response) => {
  if (!hasGeminiSession()) return response.status(401).json({ error: 'A Gemini session is not configured.' });

  let declaredSize;
  let name;
  let type;
  try {
    declaredSize = Number(request.headers['x-file-size']);
    if (!Number.isFinite(declaredSize) || !Number.isInteger(declaredSize) || declaredSize <= 0) {
      return response.status(400).json({ error: 'The file is empty or its size is invalid.' });
    }
    name = safeName(decodeHeader(request.headers['x-file-name'], 'file'));
    type = safeType(decodeHeader(request.headers['x-file-type'], 'application/octet-stream'));
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }

  let pendingCacheId = '';
  try {
    const chunks = [];
    let seen = 0;
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      seen += value.length;
      if (seen > declaredSize) {
        throw Object.assign(new Error('The upload exceeded its declared size.'), { kind: 'input' });
      }
      chunks.push(value);
    }

    if (seen !== declaredSize) throw Object.assign(new Error('The upload ended before the declared file size was received.'), { kind: 'input' });

    const id = randomUUID();
    pendingCacheId = id;
    const sourceBytes = Buffer.concat(chunks, seen);
    const sealed = sealVaultPayload(sourceBytes, { name, type });
    const vaultName = safeName(`CryoxVault__${name}.zip`);
    writeVaultCache(id, sealed.archive);

    const uploaded = await uploadGeminiIncomingStream({
      stream: Readable.from(sealed.archive),
      size: sealed.archive.length,
      name: vaultName,
      type: 'application/zip',
      isImage: false,
    });

    const record = {
      id,
      name,
      size: declaredSize,
      type,
      uploadedAt: Date.now(),
      handle: uploaded.handle,
      storageFormat: VAULT_FORMAT,
      envelopeSize: sealed.archive.length,
      vaultName,
    };

    const detailed = await attachRecordToVault(record);
    record.conversationId = String(detailed.conversationId || '');
    if (!record.conversationId) {
      const recovered = await findPersistedRecord(record);
      record.conversationId = String(recovered?.conversationId || '');
    }
    if (!record.conversationId) {
      throw Object.assign(new Error('Gemini did not confirm that the encrypted attachment was persisted in conversation history.'), { kind: 'provider' });
    }

    saveState({ conversationId: record.conversationId, updatedAt: Date.now() });
    const hiddenIds = loadHiddenIds();
    if (hiddenIds.delete(record.id)) saveHiddenIds(hiddenIds);
    const items = loadIndex();
    items.push(record);
    saveIndex(items);
    pendingCacheId = '';
    return response.json({ ok: true, file: publicRecord(record) });
  } catch (error) {
    if (pendingCacheId) {
      try {
        removeVaultCache(pendingCacheId);
      } catch {
        // No recovery action is required for a failed temporary cache cleanup.
      }
    }
    console.error('[upload]', error?.kind || error?.name || 'error', error?.message || error);
    const status = error?.kind === 'auth' ? 401 : error?.kind === 'input' ? 400 : 502;
    return response.status(status).json({ error: error?.message || 'Gemini did not accept the encrypted file.' });
  }
});

router.get('/files/:id/download', async (request, response) => {
  let id;
  try {
    id = requireUuid(request.params.id);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }

  const items = loadIndex();
  const row = items.find((item) => item.id === id);
  if (!row) return response.status(404).json({ error: 'File not found.' });

  const sendVaultEnvelope = (envelope, source) => {
    const opened = openVaultPayload(envelope);
    response.setHeader('Content-Type', row.type || opened.meta?.type || 'application/octet-stream');
    response.setHeader('Content-Length', String(opened.bytes.length));
    response.setHeader('Content-Disposition', contentDisposition(row.name || opened.meta?.name || 'file'));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Cryox-Download-Source', source);
    return response.end(opened.bytes);
  };

  let remoteUrl = safeGoogleDownloadUrl(row.remoteUrl) || safeGoogleDownloadUrl(row.handle);
  if (!remoteUrl && !hasVaultCache(row.id)) {
    remoteUrl = await resolveHistoryDownloadUrl(row);
    if (remoteUrl) {
      row.remoteUrl = remoteUrl;
      saveIndex(items);
    }
  }

  if (remoteUrl) {
    try {
      const upstream = await fetchGeminiUploadedHandle(remoteUrl, { timeoutMs: 5 * 60_000 });
      if (isVaultFormat(row.storageFormat)) {
        const envelope = await readResponseBuffer(upstream);
        return sendVaultEnvelope(envelope, 'gemini');
      }

      response.setHeader('Content-Type', upstream.headers.get('content-type') || row.type || 'application/octet-stream');
      const length = upstream.headers.get('content-length');
      if (length) response.setHeader('Content-Length', length);
      response.setHeader('Content-Disposition', contentDisposition(row.name));
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Cryox-Download-Source', 'gemini');
      if (!upstream.body) return response.end();
      return Readable.fromWeb(upstream.body).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      console.warn('[download] remote-fallback', error?.kind || error?.name || 'error', error?.message || error);
    }
  }

  try {
    const cached = readVaultCache(row.id);
    if (cached) return sendVaultEnvelope(cached, 'encrypted-shadow');
  } catch (error) {
    console.error('[download] cache', error?.name || 'error', error?.message || error);
  }

  return response.status(409).json({
    error: 'This file was uploaded by an older build and Gemini exposed only an opaque attachment handle. Upload the file once with this version to restore reliable downloads.',
  });
});

router.delete('/files/:id', (request, response) => {
  let id;
  try {
    id = requireUuid(request.params.id);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }

  const items = loadIndex();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return response.status(404).json({ error: 'File not found.' });

  const hiddenIds = loadHiddenIds();
  hiddenIds.add(id);
  saveHiddenIds(hiddenIds);
  removeVaultCache(id);
  saveIndex(next);
  return response.json({
    ok: true,
    note: 'The file was removed from the local Cryox vault and hidden from future Gemini recovery scans. The historical Gemini attachment was not deleted.',
  });
});

export default router;
