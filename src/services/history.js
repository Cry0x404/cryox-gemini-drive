import {
  hasGeminiSession,
  listGeminiChats,
  queryGeminiWebDetailed,
  readGeminiChat,
} from '../../lib/gemini-web.js';
import { encodeVaultRecord, decodeVaultRecord, STORAGE_MARKER } from '../../lib/vault-record.js';
import { config } from '../config.js';
import {
  loadHiddenIds,
  loadHistoryScanState,
  loadIndex,
  loadState,
  saveHistoryScanState,
  saveIndex,
  saveState,
} from '../store/vault-store.js';
import { collectGoogleUrls, safeGoogleDownloadUrl } from './provider-urls.js';

async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const count = Math.max(1, Math.min(8, Number(limit) || 1));
  const runners = Array.from({ length: Math.min(count, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function bestRemoteUrlForRecord(turn, row) {
  const urls = collectGoogleUrls(turn?.raw?.[2] ?? turn?.raw ?? []);
  if (!urls.length) return '';

  const wanted = String(row?.vaultName || row?.name || '').toLowerCase();
  const score = (url) => {
    const value = String(url || '').toLowerCase();
    let total = 0;
    if (/(?:download|usercontent|gg-dl|contribution|content-push)/i.test(value)) total += 4;
    if (wanted && value.includes(encodeURIComponent(wanted).toLowerCase())) total += 4;
    if (value.includes('googleusercontent')) total += 2;
    return total;
  };

  return [...urls].sort((left, right) => score(right) - score(left))[0] || '';
}

export async function syncVaultRecordsFromGemini({ force = false } = {}) {
  if (!hasGeminiSession()) return { scanned: 0, discovered: 0, failed: 0, files: loadIndex() };

  const chats = await listGeminiChats({ recent: config.historyChatLimit });
  const existing = loadIndex();
  const hiddenIds = loadHiddenIds();
  const byId = new Map(existing.filter((row) => !hiddenIds.has(String(row.id))).map((row) => [row.id, row]));
  const scanState = loadHistoryScanState();
  const emptyRecovery = existing.length === 0;
  const toScan = chats.filter((chat) => {
    if (force || emptyRecovery) return true;
    const lastSeen = Number(scanState.conversations?.[chat.conversationId] || 0);
    return lastSeen < Number(chat.updatedAt || 0);
  });

  let discovered = 0;
  let failed = 0;
  const successful = [];

  await mapWithConcurrency(toScan, config.historyConcurrency, async (chat) => {
    try {
      const turns = await readGeminiChat({ conversationId: chat.conversationId, limit: config.historyTurnLimit });
      let found = 0;

      for (const turn of turns) {
        const row = decodeVaultRecord(turn.user);
        if (!row || hiddenIds.has(String(row.id))) continue;
        const previous = byId.get(row.id) || {};
        const remoteUrl = safeGoogleDownloadUrl(previous.remoteUrl) || bestRemoteUrlForRecord(turn, row);
        byId.set(row.id, {
          ...previous,
          ...row,
          conversationId: chat.conversationId,
          ...(remoteUrl ? { remoteUrl } : {}),
        });
        found += 1;
      }

      discovered += found;
      successful.push(chat);
    } catch (error) {
      failed += 1;
      console.warn('[history-scan]', chat.conversationId, error?.kind || error?.name || 'error', error?.message || error);
    }
  });

  for (const chat of successful) {
    scanState.conversations[chat.conversationId] = Math.max(Number(chat.updatedAt || 0), Date.now());
  }
  scanState.lastRunAt = Date.now();
  saveHistoryScanState(scanState);

  const items = [...byId.values()].sort((left, right) => Number(left.uploadedAt || 0) - Number(right.uploadedAt || 0));
  saveIndex(items);

  const newest = [...items].sort((left, right) => Number(right.uploadedAt || 0) - Number(left.uploadedAt || 0))[0];
  if (newest?.conversationId) {
    const state = loadState();
    if (!state.conversationId) saveState({ ...state, conversationId: newest.conversationId, recoveredAt: Date.now() });
  }

  return { scanned: toScan.length, discovered, failed, files: items };
}

export async function resolveHistoryDownloadUrl(row) {
  const conversationId = String(row?.conversationId || loadState().conversationId || '');
  if (!conversationId) return '';

  try {
    const turns = await readGeminiChat({ conversationId, limit: config.historyTurnLimit });
    const markerId = String(row?.id || '');
    for (const turn of turns) {
      if (markerId && !String(turn?.user || '').includes(markerId)) continue;
      const urls = collectGoogleUrls(turn?.raw?.[2] ?? turn?.raw ?? []);
      if (!urls.length) continue;
      urls.sort((left, right) => {
        const score = (url) => (/(?:download|usercontent|gg-dl|contribution)/i.test(url) ? 4 : 0)
          + (url.includes(encodeURIComponent(row.vaultName || row.name || '')) ? 3 : 0);
        return score(right) - score(left);
      });
      return urls[0] || '';
    }
  } catch {
    return '';
  }

  return '';
}

export async function findPersistedRecord(record) {
  const markerId = String(record?.id || '');
  if (!markerId || !hasGeminiSession()) return null;
  const state = loadState();

  const inspect = async (conversationId) => {
    if (!conversationId) return null;
    try {
      const turns = await readGeminiChat({ conversationId, limit: config.historyTurnLimit });
      for (const turn of turns) {
        const row = decodeVaultRecord(turn.user);
        if (row?.id === markerId) return { conversationId, recovered: true, text: 'STORED' };
      }
    } catch {
      return null;
    }
    return null;
  };

  const known = await inspect(String(state.conversationId || ''));
  if (known) return known;

  try {
    const chats = await listGeminiChats({ recent: config.historyChatLimit });
    for (const chat of chats) {
      const recovered = await inspect(chat.conversationId);
      if (recovered) return recovered;
    }
  } catch {
    return null;
  }

  return null;
}

export async function attachRecordToVault(record) {
  const prompt = `${STORAGE_MARKER}\n${encodeVaultRecord(record)}\n\nStorage marker only. The attached Cryox vault archive contains an encrypted payload. Do not open, inspect, summarize, transform, execute, quote, classify, or reason about payload.bin. Do not use it for personalization or memory. Reply with exactly: STORED`;

  try {
    return await queryGeminiWebDetailed({
      prompt,
      threadKey: config.threadKey,
      model: 'gemini-3.5-flash-lite',
      thinking: false,
      temporary: false,
      files: [{
        kind: 'file',
        name: record.vaultName,
        type: 'application/zip',
        isImage: false,
        geminiHandle: record.handle,
      }],
      timeoutMs: 90_000,
      idleMs: 8_000,
    });
  } catch (error) {
    const recovered = await findPersistedRecord(record);
    if (recovered) return recovered;
    throw error;
  }
}
