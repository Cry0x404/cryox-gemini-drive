/**
 * Gemini Web client — a live gemini.google.com session.
 *
 * How it works (the same as what the browser does):
 *   1. GET  /app            -> reads the XSRF token (`thykhd`) and build id (`cfb2h`) from the page
 *   2. POST .../StreamGenerate?bl=<build>&rt=c   -> sends the message with an f.req body
 *
 * About the response format (important):
 *   Google returns a chunked stream prefixed with `)]}'`; each frame has a
 *   length line. The parser accepts the UTF-16, UTF-8-byte and legacy newline
 *   conventions seen across deployed builds, then falls back to balanced JSON
 *   scanning for older/unframed captures.
 *
 * Authentication is loaded at runtime from environment variables or a local
 * session file that is never committed to source control.
 */

import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import https from 'node:https';
import { Impit } from 'impit';
import path from 'node:path';
import { sanitizeProviderLinks } from './provider-links.js';
import { GEMINI_THREAD_DIR as DEFAULT_GEMINI_THREAD_DIR } from './storage-paths.js';

// Gemini Web keeps long conversations by carrying opaque server-side metadata
// between turns. Cryox persists only that provider continuation metadata locally
// so every upload stays in the same non-temporary Gemini conversation.
const DEFAULT_CHAT_METADATA = Object.freeze(['', '', '', null, null, null, null, null, null, '']);
const GEMINI_THREAD_DIR = path.resolve(process.env.CRYOX_GEMINI_THREAD_DIR || DEFAULT_GEMINI_THREAD_DIR);
const geminiThreadCache = new Map();

function normalizeChatMetadata(value) {
  const out = [...DEFAULT_CHAT_METADATA];
  if (!Array.isArray(value)) return out;
  for (let i = 0; i < Math.min(10, value.length); i += 1) {
    if (value[i] !== undefined && value[i] !== null) out[i] = value[i];
  }
  return out;
}

function geminiThreadId(threadKey) {
  const raw = String(threadKey || '').trim();
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex');
}

function geminiThreadPath(threadKey) {
  const id = geminiThreadId(threadKey);
  return id ? path.join(GEMINI_THREAD_DIR, `${id}.json`) : '';
}

function loadGeminiThreadState(threadKey) {
  const id = geminiThreadId(threadKey);
  if (!id) return null;
  if (geminiThreadCache.has(id)) return geminiThreadCache.get(id);
  const filename = geminiThreadPath(threadKey);
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!Array.isArray(parsed?.metadata) || !parsed.metadata[0]) return null;
    const state = {
      metadata: normalizeChatMetadata(parsed.metadata),
      temporary: parsed.temporary !== false,
      updatedAt: Number(parsed.updatedAt || 0),
    };
    geminiThreadCache.set(id, state);
    return state;
  } catch {
    return null;
  }
}

function saveGeminiThreadState(threadKey, metadata, temporary) {
  const id = geminiThreadId(threadKey);
  if (!id || !Array.isArray(metadata) || !metadata[0]) return;
  const state = {
    metadata: normalizeChatMetadata(metadata),
    temporary: temporary !== false,
    updatedAt: Date.now(),
  };
  geminiThreadCache.set(id, state);
  try {
    fs.mkdirSync(GEMINI_THREAD_DIR, { recursive: true, mode: 0o700 });
    const filename = geminiThreadPath(threadKey);
    const temp = `${filename}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, filename);
  } catch (error) {
    console.warn('[gemini-thread] could not persist provider metadata:', error?.message || error);
  }
}

export function clearGeminiThreadState(threadKey) {
  const id = geminiThreadId(threadKey);
  if (!id) return;
  geminiThreadCache.delete(id);
  try { fs.rmSync(geminiThreadPath(threadKey), { force: true }); } catch { /* best effort */ }
}

export function hasGeminiThreadState(threadKey) {
  return Boolean(loadGeminiThreadState(threadKey)?.metadata?.[0]);
}

import { loadGeminiSession } from './session-store.js';


const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const browserTransport = new Impit({ browser: 'chrome' });

const APP_URL = 'https://gemini.google.com/app';
const STREAM_URL =
  'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const CURRENT_PUSH_URL = 'https://push.clients6.google.com/upload/';
const CONTENT_PUSH_URL = 'https://content-push.googleapis.com/upload/';

const MAX_ATTACHMENT_COUNT = 20;
const GEMINI_ATTACHMENTS_PER_TURN = 10;
const CONTENT_PUSH_ID = 'feeds/mcudyrk2a4khkz';
const SESSION_TTL_MS = 20 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90_000;

export const GEMINI_WEB_MODELS = Object.freeze([
  'gemini-3.6-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
]);

export const GEMINI_WEB_REASONING_SELECTOR = Object.freeze({ FAST: 1, HIGH: 2 });

// Cryox Drive intentionally pins storage acknowledgements to Gemini 3.5 Flash Lite.
// The actual opaque model id/header is discovered from the signed-in account at runtime
// (matching the current reference client's current behavior) instead of relying on a stale hard-coded id.
export const CRYOX_STORAGE_MODEL = 'gemini-3.5-flash-lite';
const MODEL_HEADER_KEY = 'x-goog-ext-525001261-jspb';
let modelDiscoveryCache = { models: [], time: 0 };
let modelSessionId = randomUUID().toUpperCase();

export function resolveGeminiWebReasoningSelector(thinking) {
  return thinking ? GEMINI_WEB_REASONING_SELECTOR.HIGH : GEMINI_WEB_REASONING_SELECTOR.FAST;
}

export function resolveGeminiWebModelSelector(model) {
  const targetModel = String(model || 'gemini-3.6-flash');
  if (targetModel.includes('pro')) return 3;
  if (targetModel.includes('lite')) return 6;
  return 1;
}

const IDLE_TIMEOUT_MS = 60_000;
const FIRST_BYTE_TIMEOUT_MS = 15_000;
const MAX_SESSION_HTML_BYTES = 12 * 1024 * 1024;
const MAX_RESPONSE_HEADER_BYTES = 128 * 1024;

function languageSample(prompt) {
  const value = String(prompt || '');
  const jsonMarker = 'USER_MESSAGE_JSON=';
  const j = value.lastIndexOf(jsonMarker);
  if (j !== -1) {
    const raw = value.slice(j + jsonMarker.length).trim();
    try { return String(JSON.parse(raw)).slice(0, 5000); } catch { /* fall through */ }
  }
  const markers = ['[AUTHORITATIVE_USER_REQUEST]', '[AUTHORITATIVE USER REQUEST — preserve its exact meaning]', 'USER_REQUEST_JSON', 'Research topic:', 'Topic:'];
  for (const marker of markers) {
    const i = value.lastIndexOf(marker);
    if (i !== -1) return value.slice(i + marker.length).trim().slice(0, 5000);
  }
  return value.slice(-5000);
}

function inferRequestLocale(prompt) {
  const sample = languageSample(prompt);
  const scripts = [
    ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
    ['ko', /\p{Script=Hangul}/gu],
    ['ar', /\p{Script=Arabic}/gu],
    ['ru', /\p{Script=Cyrillic}/gu],
    ['hi', /\p{Script=Devanagari}/gu],
    ['he', /\p{Script=Hebrew}/gu],
    ['el', /\p{Script=Greek}/gu],
    ['th', /\p{Script=Thai}/gu],
    ['bn', /\p{Script=Bengali}/gu],
    ['ta', /\p{Script=Tamil}/gu],
    ['te', /\p{Script=Telugu}/gu],
    ['hy', /\p{Script=Armenian}/gu],
    ['ka', /\p{Script=Georgian}/gu],
    ['zh', /\p{Script=Han}/gu],
  ];
  let best = ['en', 0];
  for (const [locale, re] of scripts) {
    const n = (sample.match(re) || []).length;
    if (n > best[1]) best = [locale, n];
  }
  return best[1] >= 2 ? best[0] : 'en';
}

export class GeminiError extends Error {
  constructor(message, { kind = 'unknown' } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
  }
}


/** @type {{psid: string, psidts: string, extra: Record<string,string>}} */
let cookies = loadGeminiSession();
let cookieHeaderMode = 'essential';

export function setGeminiCookies(value) {
  const next = value && typeof value === 'object' ? value : {};
  cookies = {
    psid: String(next.psid || '').trim(),
    psidts: String(next.psidts || '').trim(),
    extra: next.extra && typeof next.extra === 'object' ? { ...next.extra } : {},
  };
  resetSession();
  return hasGeminiSession();
}

export function reloadGeminiSession() {
  cookies = loadGeminiSession();
  resetSession();
  return hasGeminiSession();
}

export function hasGeminiSession() {
  return Boolean(cookies.psid && cookies.psidts);
}

function buildCookieHeader({ essentialOnly = false } = {}) {
  const parts = [];
  if (cookies.psid) parts.push(`__Secure-1PSID=${cookies.psid}`);
  if (cookies.psidts) parts.push(`__Secure-1PSIDTS=${cookies.psidts}`);
  // The current transport only requires the two essential authenticated
  // Gemini session cookies. Auxiliary browser cookies are intentionally not
  // persisted or forwarded.
  if (!essentialOnly) {
    for (const [name, value] of Object.entries(cookies.extra || {})) {
      if (value) parts.push(`${name}=${value}`);
    }
  }
  return parts.join('; ');
}

function activeCookieHeader() {
  return buildCookieHeader({ essentialOnly: cookieHeaderMode !== 'full' });
}

function safeAttachmentName(value, index = 0) {
  return String(value || `attachment-${index + 1}`)
    .replace(/[\\/\x00-\x1f\x7f]+/g, '_')
    .trim()
    .slice(0, 180) || `attachment-${index + 1}`;
}

function decodeAttachmentDataUrl(file, index) {
  const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl : '';
  const match = /^data:([^;,]{1,120});base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) return null;

  const type = String(match[1] || file?.type || 'application/octet-stream').toLowerCase();
  let bytes;
  try { bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64'); } catch { return null; }
  if (!bytes.length) return null;

  return {
    name: safeAttachmentName(file?.name, index),
    type,
    bytes,
    isImage: file?.isImage === true || String(file?.kind || '') === 'image' || /^image\//i.test(type),
  };
}

function normalizeGeminiAttachments(files = []) {
  return (Array.isArray(files) ? files : [])
    .map(decodeAttachmentDataUrl)
    .filter(Boolean)
    .slice(0, MAX_ATTACHMENT_COUNT);
}

function cleanUploadHandle(value) {
  let result = String(value || '').trim();
  if (!result || result.length > 8_192) return '';
  // Some content-push revisions wrap the handle as a JSON string.
  if (result.startsWith('"') && result.endsWith('"')) {
    try { result = String(JSON.parse(result) || '').trim(); } catch { /* use raw text */ }
  }
  if (
    !result ||
    result.length > 4_096 ||
    /[<>\s\x00-\x1f\x7f]/.test(result) ||
    result.startsWith('{') ||
    result.startsWith('[')
  ) return '';
  try {
    const parsed = new URL(result);
    const host = parsed.hostname.toLowerCase();
    const trustedHost = host === 'push.clients6.google.com' ||
      host === 'content-push.googleapis.com' ||
      host.endsWith('.googleapis.com') ||
      host === 'googleusercontent.com' ||
      host.endsWith('.googleusercontent.com');
    if (parsed.protocol !== 'https:' || !trustedHost) return '';
    return parsed.href;
  } catch {
    // Current content-push revisions may return an opaque identifier rather
    // than an absolute URL. It is inserted only as data in StreamGenerate.
    return /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(result) ? result : '';
  }
}

function safeUploadContinuationUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    const trustedHost = host === 'push.clients6.google.com' ||
      host === 'content-push.googleapis.com' ||
      host.endsWith('.googleapis.com');
    if (parsed.protocol !== 'https:' || !trustedHost) return '';
    return parsed.href;
  } catch { return ''; }
}

function cleanContentPushId(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9._:/-]{1,240}$/.test(candidate) ? candidate : CONTENT_PUSH_ID;
}

function cleanUploadClientPctx(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 2_048 || /[\x00-\x1f\x7f]/.test(candidate)) return '';
  return candidate;
}

function attachmentUploadError(message, stage, { retryable = true } = {}) {
  const error = new GeminiError(message, { kind: 'attachment' });
  error.uploadStage = String(stage || 'unknown');
  error.retryable = Boolean(retryable);
  return error;
}

function logAttachmentUploadFailure(stage, { status = 0, error = null } = {}) {
  const statusText = Number.isFinite(Number(status)) && Number(status) > 0
    ? ` status=${Number(status)}`
    : '';
  const reason = error?.name && /^[A-Za-z0-9_.-]{1,80}$/.test(String(error.name))
    ? ` reason=${error.name}`
    : '';
  // Never log response bodies, identifiers, filenames, cookies or URLs.
  console.warn(`[attachment-upload] stage=${stage}${statusText}${reason}`);
}

async function attachmentUploadRequest(url, options, { fetchImpl, stage }) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    logAttachmentUploadFailure(stage, { error });
    throw attachmentUploadError('The attachment transport was interrupted.', stage);
  }
  if (!response?.ok) {
    logAttachmentUploadFailure(stage, { status: response?.status });
    throw attachmentUploadError('The attachment service rejected the upload.', stage);
  }
  return response;
}


function attachmentByteLength(attachment) {
  if (Buffer.isBuffer(attachment?.bytes)) return attachment.bytes.length;
  return Math.max(0, Number(attachment?.size) || 0);
}

function attachmentRequestBody(attachment) {
  if (Buffer.isBuffer(attachment?.bytes)) return attachment.bytes;
  if (attachment?.stream && typeof attachment.stream.pipe === 'function') return attachment.stream;
  return null;
}

function streamingFetchOptions(attachment) {
  return Buffer.isBuffer(attachment?.bytes) ? {} : { duplex: 'half' };
}

async function uploadAttachmentCurrent(attachment, {
  signal,
  fetchImpl,
  pushId = CONTENT_PUSH_ID,
  clientPctx = '',
}) {
  const safeClientPctx = cleanUploadClientPctx(clientPctx);
  if (!safeClientPctx) {
    throw attachmentUploadError(
      'The attachment session is missing its upload context.',
      'current-missing-client-context',
    );
  }

  // The current Gemini Web client performs two POSTs. Node does not need the
  // browser's CORS preflight, so avoiding manual OPTIONS requests keeps image
  // turns fast and prevents an otherwise-valid upload from failing at preflight.
  const uploadHeaders = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.7',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    Origin: 'https://gemini.google.com',
    Referer: 'https://gemini.google.com/',
    'Push-ID': cleanContentPushId(pushId),
    'User-Agent': UA,
    'X-Client-Pctx': safeClientPctx,
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': String(attachmentByteLength(attachment)),
    'X-Goog-Upload-Header-Content-Type': attachment.type,
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Tenant-ID': 'bard-storage',
  };

  const start = await attachmentUploadRequest(CURRENT_PUSH_URL, {
    method: 'POST',
    headers: uploadHeaders,
    body: `File name: ${attachment.name}`,
    signal,
  }, { fetchImpl, stage: 'current-start' });
  const continuation = safeUploadContinuationUrl(start.headers?.get?.('x-goog-upload-url'));
  if (!continuation) {
    logAttachmentUploadFailure('current-start-missing-url');
    throw attachmentUploadError(
      'The attachment service did not return an upload session.',
      'current-start-missing-url',
    );
  }

  const final = await attachmentUploadRequest(continuation, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': attachment.type,
      'Content-Length': String(attachmentByteLength(attachment)),
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      'User-Agent': UA,
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: attachmentRequestBody(attachment),
    signal,
    ...streamingFetchOptions(attachment),
  }, { fetchImpl, stage: 'current-finalize' });
  const handle = cleanUploadHandle(await final.text());
  if (!handle) {
    logAttachmentUploadFailure('current-invalid-identifier');
    throw attachmentUploadError(
      'The attachment service returned an invalid identifier.',
      'current-invalid-identifier',
    );
  }
  return handle;
}

async function uploadAttachmentLegacy(attachment, {
  signal,
  fetchImpl,
  pushId = CONTENT_PUSH_ID,
  cookieHeader = '',
}) {
  // Compatibility route for non-image binaries and for accounts that have not
  // received the current push transport yet. This remains two POSTs server-side.
  const uploadHeaders = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.7',
    Authorization: 'Basic c2F2ZXM6cyNMdGhlNmxzd2F2b0RsN3J1d1U=',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    Origin: 'https://gemini.google.com',
    Referer: 'https://gemini.google.com/',
    'Push-ID': cleanContentPushId(pushId),
    'User-Agent': UA,
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': String(attachmentByteLength(attachment)),
    'X-Goog-Upload-Header-Content-Type': attachment.type,
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Tenant-ID': 'bard-storage',
  };
  if (cookieHeader) uploadHeaders.Cookie = cookieHeader;

  const start = await attachmentUploadRequest(CONTENT_PUSH_URL, {
    method: 'POST',
    headers: uploadHeaders,
    body: `File name: ${attachment.name}`,
    signal,
  }, { fetchImpl, stage: 'legacy-start' });
  const continuation = safeUploadContinuationUrl(start.headers?.get?.('x-goog-upload-url'));
  if (!continuation) {
    logAttachmentUploadFailure('legacy-start-missing-url');
    throw attachmentUploadError(
      'The attachment service did not return an upload session.',
      'legacy-start-missing-url',
    );
  }

  const final = await attachmentUploadRequest(continuation, {
    method: 'POST',
    headers: {
      ...uploadHeaders,
      'Content-Type': attachment.type,
      'Content-Length': String(attachmentByteLength(attachment)),
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: attachmentRequestBody(attachment),
    signal,
    ...streamingFetchOptions(attachment),
  }, { fetchImpl, stage: 'legacy-finalize' });
  const handle = cleanUploadHandle(await final.text());
  if (!handle) {
    logAttachmentUploadFailure('legacy-invalid-identifier');
    throw attachmentUploadError(
      'The attachment service returned an invalid identifier.',
      'legacy-invalid-identifier',
    );
  }
  return handle;
}

async function uploadAttachmentResumable(attachment, options) {
  if (attachment.isImage && cleanUploadClientPctx(options.clientPctx)) {
    try {
      return await uploadAttachmentCurrent(attachment, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      // A controlled fallback keeps older/partially rolled-out accounts usable.
      // The original failure details stay server-only and never expose tokens.
      console.warn(`[attachment-upload] fallback=legacy after=${error?.uploadStage || 'current-unknown'}`);
    }
  }
  return uploadAttachmentLegacy(attachment, options);
}

async function uploadGeminiAttachments(files, {
  signal,
  fetchImpl = globalThis.fetch,
  pushId = CONTENT_PUSH_ID,
  clientPctx = '',
  cookieHeader = '',
} = {}) {
  const incoming = Array.isArray(files) ? files : [];
  const nativeBinaryFiles = incoming.filter((file) => (
    (typeof file?.geminiHandle === 'string' && cleanUploadHandle(file.geminiHandle))
    || file?.isImage === true
    || String(file?.kind || '') === 'image'
    || (!file?.textContent && String(file?.kind || '') === 'file')
  ));
  if (nativeBinaryFiles.length > MAX_ATTACHMENT_COUNT) {
    throw new GeminiError(`A message can contain at most ${MAX_ATTACHMENT_COUNT} binary attachments.`, { kind: 'input' });
  }

  const alreadyUploaded = nativeBinaryFiles
    .filter((file) => typeof file?.geminiHandle === 'string' && file.geminiHandle.trim())
    .map((file, index) => ({
      handle: cleanUploadHandle(file.geminiHandle),
      name: safeAttachmentName(file?.name, index),
      isImage: file?.isImage === true || String(file?.kind || '') === 'image',
    }))
    .filter((item) => item.handle);
  const needsUpload = nativeBinaryFiles.filter((file) => !(typeof file?.geminiHandle === 'string' && cleanUploadHandle(file.geminiHandle)));
  const attachments = normalizeGeminiAttachments(needsUpload);
  const missingBinary = needsUpload.some((file) => !decodeAttachmentDataUrl(file, 0));
  if (missingBinary) {
    throw attachmentUploadError(
      'An attachment is missing its streamed Gemini upload handle. Reattach the file and try again.',
      'local-validation',
      { retryable: false },
    );
  }
  if (!attachments.length) return alreadyUploaded;
  if (typeof fetchImpl !== 'function') throw new GeminiError('Attachment upload is temporarily unavailable.', { kind: 'network' });

  const timeout = AbortSignal.timeout(120_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const fresh = [];
    // Keep provider upload pressure bounded instead of holding many large buffers concurrently.
    for (const attachment of attachments) {
      const handle = await uploadAttachmentResumable(attachment, { signal: combined, fetchImpl, pushId, clientPctx, cookieHeader });
      fresh.push({ handle, name: attachment.name, isImage: attachment.isImage });
    }
    return [...alreadyUploaded, ...fresh];
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof GeminiError) throw error;
    throw attachmentUploadError('The attachment could not be uploaded for analysis. Please try again.', 'unknown');
  }
}



export async function uploadGeminiIncomingStream({ stream, size, name = 'attachment', type = 'application/octet-stream', isImage = false, signal } = {}) {
  const cleanSize = Math.max(0, Number(size) || 0);
  if (!stream || typeof stream.pipe !== 'function') throw new GeminiError('Attachment stream is unavailable.', { kind: 'input' });
  if (!cleanSize) throw new GeminiError('Attachment size is invalid.', { kind: 'input' });
  const session = await getSession();
  const attachment = {
    name: safeAttachmentName(name),
    type: String(type || 'application/octet-stream').slice(0, 120),
    size: cleanSize,
    stream,
    isImage: Boolean(isImage),
  };
  // A request stream cannot be replayed after a failed current->legacy fallback,
  // so use the cookie-authenticated resumable transport directly for streamed files.
  const timeout = AbortSignal.timeout(30 * 60_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const handle = await uploadAttachmentLegacy(attachment, {
    signal: combined,
    fetchImpl: globalThis.fetch,
    pushId: session.pushId || CONTENT_PUSH_ID,
    cookieHeader: activeCookieHeader(),
  });
  return { handle, name: attachment.name, isImage: attachment.isImage };
}

/** Server-only headers for fetching a generated Gemini image. */
export function geminiGeneratedMediaRequestHeaders() {
  return {
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    Cookie: activeCookieHeader(),
    Referer: 'https://gemini.google.com/',
    Origin: 'https://gemini.google.com',
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

/** Keeps the in-memory cookie jar in sync with Google's normal session refresh. */
function absorbSetCookies(values) {
  for (const line of Array.isArray(values) ? values : values ? [values] : []) {
    const first = String(line).split(';', 1)[0];
    const separator = first.indexOf('=');
    if (separator <= 0) continue;
    const name = first.slice(0, separator).trim();
    const value = first.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name)) continue;
    const removed = !value || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(String(line));
    if (name === '__Secure-1PSID') {
      if (!removed) cookies.psid = value;
    } else if (name === '__Secure-1PSIDTS') {
      if (!removed) cookies.psidts = value;
    } else if (removed) {
      delete cookies.extra[name];
    } else {
      cookies.extra[name] = value;
    }
  }
}

/**
 * Node's built-in fetch rejects some valid Gemini responses because Google's
 * Set-Cookie headers exceed undici's small default header limit. Use the native
 * HTTPS client for those downloads and raise only that limit; credentials never
 * enter a command line, log entry, URL, or response error.
 */
function httpsRequestBuffer(url, {
  method = 'GET',
  headers = {},
  body = null,
  signal,
  timeoutMs = 30_000,
  maxBytes = MAX_SESSION_HTML_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onAbort = () => req?.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Request aborted.'));

    if (signal?.aborted) {
      finish(reject, signal.reason instanceof Error ? signal.reason : new Error('Request aborted.'));
      return;
    }

    req = https.request(url, {
      method,
      headers,
      maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
    }, (res) => {
      const chunks = [];
      let total = 0;

      res.on('data', (chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += value.length;
        if (total > maxBytes) {
          req.destroy(new Error('Gemini response exceeded the safe size limit.'));
          return;
        }
        chunks.push(value);
      });
      res.on('end', () => finish(resolve, {
        status: Number(res.statusCode || 0),
        headers: res.headers,
        buffer: Buffer.concat(chunks),
      }));
      res.on('error', (error) => finish(reject, error));
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Gemini request timed out.')));
    req.on('error', (error) => finish(reject, error));
    if (body) req.write(body);
    req.end();
  });
}

async function browserFetch(url, options = {}) {
  return browserTransport.fetch(url, options);
}

async function browserFetchBuffer(url, {
  headers = {},
  signal,
  timeoutMs = 30_000,
  maxBytes = MAX_SESSION_HTML_BYTES,
} = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await browserFetch(url, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: combined,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('Gemini response exceeded the safe size limit.');
  const headersObject = {
    location: response.headers.get('location') || '',
    'set-cookie': response.headers.getSetCookie?.() || [],
  };
  return {
    status: Number(response.status || 0),
    headers: headersObject,
    buffer,
  };
}

function sessionRequestHeaders() {
  return {
    Cookie: activeCookieHeader(),
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: 'https://gemini.google.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  };
}

function safeGeminiSessionRedirect(currentUrl, location) {
  try {
    const next = new URL(String(location || ''), currentUrl);
    if (next.protocol !== 'https:' || next.hostname.toLowerCase() !== 'gemini.google.com') return '';
    return next.href;
  } catch {
    return '';
  }
}

async function fetchGeminiSessionPage() {
  let currentUrl = APP_URL;
  let lastResponse = null;

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    let response;
    try {
      response = await browserFetchBuffer(currentUrl, {
        headers: sessionRequestHeaders(),
        timeoutMs: 30_000,
        maxBytes: MAX_SESSION_HTML_BYTES,
      });
    } catch (browserError) {
      response = await httpsRequestBuffer(currentUrl, {
        headers: sessionRequestHeaders(),
        timeoutMs: 30_000,
        maxBytes: MAX_SESSION_HTML_BYTES,
      });
      if (!response) throw browserError;
    }
    absorbSetCookies(response.headers['set-cookie']);
    lastResponse = response;

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.location;
    const nextUrl = safeGeminiSessionRedirect(currentUrl, location);
    if (!nextUrl) {
      return {
        ...response,
        redirectLocation: String(location || ''),
      };
    }

    currentUrl = nextUrl;
  }

  return {
    ...lastResponse,
    redirectLoop: true,
  };
}

/* ------------------------------------------------------------------ */
/* Session (XSRF token + build id)                                     */
/* ------------------------------------------------------------------ */

let session = { token: '', build: '', sid: '', language: 'en', pushId: CONTENT_PUSH_ID, clientPctx: '', time: 0 };
let sessionPromise = null;

function resetSession() {
  cookieHeaderMode = 'essential';
  session = { token: '', build: '', sid: '', language: 'en', pushId: CONTENT_PUSH_ID, clientPctx: '', time: 0 };
  modelDiscoveryCache = { models: [], time: 0 };
  modelSessionId = randomUUID().toUpperCase();
}

async function getSession({ force = false } = {}) {
  if (!hasGeminiSession()) {
    throw new GeminiError('Gemini session cookies are not configured.', { kind: 'no-cookies' });
  }

  if (!force && session.token && Date.now() - session.time < SESSION_TTL_MS) return session;
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const modes = Object.keys(cookies.extra || {}).length ? ['full', 'essential'] : ['essential'];
    let lastFailure = null;

    for (const mode of modes) {
      let res = null;
      let lastErr = null;
      cookieHeaderMode = mode;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await fetchGeminiSessionPage();
          break;
        } catch (error) {
          lastErr = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        }
      }

      if (!res) {
        const cause = lastErr?.cause?.message ? ` (${lastErr.cause.message})` : '';
        const message = lastErr?.message || 'unknown error';
        console.error('[gemini-web] upstream session fetch failed:', message + cause);
        throw new GeminiError(`Could not connect to Gemini: ${message}${cause}`, { kind: 'network' });
      }

      if (res.status === 401 || res.status === 403) {
        lastFailure = new GeminiError('Gemini rejected the browser session cookies.', { kind: 'auth' });
        continue;
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        let destination = '';
        try { destination = new URL(res.redirectLocation || '', APP_URL).hostname.toLowerCase(); } catch {}
        lastFailure = new GeminiError(
          destination && destination !== 'gemini.google.com'
            ? 'Gemini redirected this browser session to Google sign-in. Refresh cookies.json from an active Gemini tab.'
            : 'Gemini redirected the session bootstrap before authentication completed.',
          { kind: 'auth' },
        );
        continue;
      }

      if (res.status !== 200) {
        lastFailure = new GeminiError(`Gemini session bootstrap failed (HTTP ${res.status}).`, { kind: 'http' });
        continue;
      }

      const html = res.buffer.toString('utf8');
      const tokenMatch = html.match(/"SNlM0e":\s*"(.*?)"/);
      if (!tokenMatch?.[1]) {
        lastFailure = new GeminiError('Gemini returned a signed-out page for the supplied browser session.', { kind: 'auth' });
        continue;
      }

      const buildMatch = html.match(/"cfb2h":\s*"(.*?)"/) || html.match(/boq_assistant-bard-web-server_[A-Za-z0-9_.-]+/);
      const sidMatch = html.match(/"FdrFJe":\s*"(.*?)"/) || html.match(/FdrFJe(?:\\?"|"):\\?"([^"\\]+)(?:\\?"|")/);
      const languageMatch = html.match(/"TuX5cc":\s*"(.*?)"/);
      const pushIdMatch = html.match(/"qKIAYe":\s*"(.*?)"/) || html.match(/qKIAYe(?:\\?"|"):\\?"([^"\\]+)(?:\\?"|")/);
      const clientPctxMatch = html.match(/"Ylro7b":\s*"(.*?)"/) || html.match(/Ylro7b(?:\\?"|"):\\?"([^"\\]+)(?:\\?"|")/);

      session = {
        token: tokenMatch[1],
        build: buildMatch ? (buildMatch[1] || buildMatch[0]) : '',
        sid: sidMatch?.[1] || '',
        language: String(languageMatch?.[1] || 'en').slice(0, 12),
        pushId: cleanContentPushId(pushIdMatch?.[1] || CONTENT_PUSH_ID),
        clientPctx: cleanUploadClientPctx(clientPctxMatch?.[1] || ''),
        time: Date.now(),
      };
      return session;
    }

    cookieHeaderMode = 'essential';
    throw lastFailure || new GeminiError('Gemini rejected the browser session cookies.', { kind: 'auth' });
  })().finally(() => { sessionPromise = null; });

  return sessionPromise;
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

const BACKSLASH = String.fromCharCode(92);

/**
 * Gemini Web's StreamGenerate transport is length-prefixed. Different deployed
 * builds have counted either UTF-16 units or UTF-8 bytes, and older captures
 * included the header newline. Try all three conventions before falling back to
 * bracket scanning so live streaming survives provider transport changes.
 */
function utf8EndIndex(text, start, declaredBytes) {
  let cursor = start;
  let bytes = 0;
  while (cursor < text.length && bytes < declaredBytes) {
    const codePoint = text.codePointAt(cursor);
    const character = String.fromCodePoint(codePoint);
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > declaredBytes) return -2;
    bytes += size;
    cursor += character.length;
  }
  return bytes === declaredBytes ? cursor : -1;
}

function decodeFramePayload(payload) {
  try {
    const parsed = JSON.parse(String(payload || '').trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

export function parseLengthPrefixedFrames(buffer) {
  const parts = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    while (cursor < buffer.length && /\s/.test(buffer[cursor])) cursor++;
    if (cursor >= buffer.length) break;

    const match = /^(\d+)\r?\n/.exec(buffer.slice(cursor));
    if (!match) break;

    const declaredLength = Number(match[1]);
    if (!Number.isFinite(declaredLength) || declaredLength <= 0) break;

    const afterHeader = cursor + match[0].length;
    const afterDigits = cursor + match[1].length;
    const byteEnd = utf8EndIndex(buffer, afterHeader, declaredLength);
    const candidates = [
      afterHeader + declaredLength,
      afterDigits + declaredLength,
      byteEnd,
    ].filter((end, index, all) => end >= afterHeader && end <= buffer.length && all.indexOf(end) === index);

    let accepted = false;
    for (const frameEnd of candidates) {
      const decoded = decodeFramePayload(buffer.slice(afterHeader, frameEnd)) ||
        decodeFramePayload(buffer.slice(afterDigits, frameEnd));
      if (!decoded) continue;
      parts.push(...decoded);
      cursor = frameEnd;
      accepted = true;
      break;
    }
    if (!accepted) break;
  }

  return { parts, rest: buffer.slice(cursor) };
}

/**
 * Compatibility parser for old/unframed captures. This is intentionally only a
 * fallback; live progress should use parseLengthPrefixedFrames() above.
 */
function scanFrames(text) {
  const frames = [];
  let cursor = 0;

  for (;;) {
    const start = text.indexOf('[["wrb.fr"', cursor);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === BACKSLASH) { if (inString) escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }

    if (end === -1) break;
    try { frames.push(JSON.parse(text.slice(start, end))); } catch { /* skip */ }
    cursor = end;
  }

  return frames;
}

function normalizeWrbParts(input) {
  const out = [];
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value[0] === 'wrb.fr') { out.push(value); return; }
    for (const child of value) {
      if (Array.isArray(child)) visit(child);
    }
  };
  for (const value of Array.isArray(input) ? input : []) visit(value);
  return out;
}

function safeGeneratedImageUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    const host = parsed.hostname.toLowerCase();
    // Gemini image generations currently resolve through Google-hosted media.
    // Keep parsing conservative so arbitrary URLs inside model text are never
    // promoted into trusted image cards.
    if (!(host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com') || host.endsWith('.ggpht.com'))) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function generatedImageUrlCandidates(value, depth = 0, out = []) {
  if (depth > 7 || value == null) return out;
  if (typeof value === 'string') {
    const url = safeGeneratedImageUrl(value);
    if (url && !out.includes(url)) out.push(url);
    return out;
  }
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 80)) generatedImageUrlCandidates(child, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value).slice(0, 80)) generatedImageUrlCandidates(child, depth + 1, out);
  }
  return out;
}

/**
 * Current Gemini Web image generations are attached to the candidate's media
 * payload at candidate[12][7][0]. Keep the parser isolated and defensive: if
 * Google shifts the internal shape, ordinary text replies continue working.
 */
export function parseGeminiGeneratedImages(candidate) {
  if (!Array.isArray(candidate)) return [];
  const media = Array.isArray(candidate?.[12]?.[7]?.[0]) ? candidate[12][7][0] : [];
  const images = [];
  const seen = new Set();

  for (const item of media.slice(0, 16)) {
    // Reverse-engineered current clients place the full image URLs under
    // item[0][3]. Search only that generated-media container first; a broader
    // fallback within this media item keeps the parser resilient.
    const primary = item?.[0]?.[3];
    const urls = generatedImageUrlCandidates(primary);
    if (!urls.length) generatedImageUrlCandidates(item, 0, urls);
    if (!urls.length) continue;

    const preferred = urls.find((url) => /\/rd-gg\//i.test(url)) || urls[urls.length - 1] || urls[0];
    if (!preferred || seen.has(preferred)) continue;
    seen.add(preferred);

    let alt = '';
    try {
      const rawAlt = item?.[0]?.[3]?.[2];
      if (typeof rawAlt === 'string' && !/^https?:/i.test(rawAlt)) alt = rawAlt.trim().slice(0, 300);
    } catch { /* optional metadata */ }

    images.push({ url: preferred, alt: alt || `Generated image ${images.length + 1}` });
  }
  return images;
}

function normalizeGeminiSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return '';

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    // Gemini/Google UI redirectors can wrap the actual public source. Unwrap
    // only when the target is explicit; opaque provider URLs are not useful as
    // durable Cryox citations.
    if (host === 'google.com' && parsed.pathname === '/url') {
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (target) return normalizeGeminiSourceUrl(target);
    }

    if (
      host === 'gemini.google.com' ||
      host === 'accounts.google.com' ||
      host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com') ||
      host === 'gstatic.com' || host.endsWith('.gstatic.com') ||
      host === 'googleapis.com' || host.endsWith('.googleapis.com')
    ) return '';

    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

function collectGeminiSourceUrls(value, out = new Set(), depth = 0) {
  if (depth > 14 || out.size >= 32 || value == null) return out;
  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s\"'<>\]\)\}]+/gi) || [];
    for (const candidate of matches) {
      const normalized = normalizeGeminiSourceUrl(candidate.replace(/[.,;:!?]+$/g, ''));
      if (normalized) out.add(normalized);
      if (out.size >= 32) break;
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectGeminiSourceUrls(child, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value)) collectGeminiSourceUrls(child, out, depth + 1);
  }
  return out;
}

function mergeReplyParts(parts, seed = null) {
  const result = seed ? {
    ...seed,
    images: Array.isArray(seed.images) ? [...seed.images] : [],
    sourceUrls: Array.isArray(seed.sourceUrls) ? [...seed.sourceUrls] : [],
  } : {
    text: '', conversationId: '', responseId: '', choiceId: '', metadata: null, errorCode: null, images: [], sourceUrls: [],
  };
  const imageUrls = new Set(result.images.map((item) => String(item?.url || '')).filter(Boolean));
  const sourceUrls = new Set(result.sourceUrls.map((item) => String(item || '')).filter(Boolean));

  for (const item of normalizeWrbParts(parts)) {
    if (typeof item[2] !== 'string') {
      // The current reference client reads fatal stream errors from [5][2][0][1][0].
      // Keep the old shallow slot only as a compatibility fallback.
      const currentError = item?.[5]?.[2]?.[0]?.[1]?.[0];
      const legacyError = item?.[5]?.[0];
      if (typeof currentError === 'number') result.errorCode = currentError;
      else if (typeof legacyError === 'number') result.errorCode = legacyError;
      continue;
    }

    let inner;
    try { inner = JSON.parse(item[2]); } catch { continue; }

    for (const url of collectGeminiSourceUrls(inner)) sourceUrls.add(url);

    const ids = Array.isArray(inner?.[1]) ? inner[1] : [];
    if (ids[0]) {
      result.metadata = normalizeChatMetadata(ids);
      result.conversationId = ids[0];
      if (ids[1]) result.responseId = ids[1];
    }
    // Current Gemini Web also emits an opaque continuation context in field 25
    // on final stream frames. Keep it together with cid/rid/rcid so the next
    // turn mirrors the provider's own ChatSession metadata instead of relying
    // on only the three visible ids.
    if (typeof inner?.[25] === 'string' && inner[25]) {
      if (!result.metadata) result.metadata = normalizeChatMetadata(ids);
      result.metadata[9] = inner[25];
    }

    const candidates = Array.isArray(inner?.[4]) ? inner[4] : [];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;

      for (const image of parseGeminiGeneratedImages(candidate)) {
        if (!imageUrls.has(image.url)) {
          imageUrls.add(image.url);
          result.images.push(image);
        }
      }

      if (!Array.isArray(candidate[1])) continue;
      const candidateText = candidate[1]
        .map((part) => {
          if (typeof part === 'string') return part;
          if (Array.isArray(part) && typeof part[0] === 'string') return part[0];
          return '';
        })
        .join('');
      if (candidateText.length >= result.text.length) {
        result.text = candidateText;
        result.choiceId = candidate[0] || result.choiceId || '';
        if (result.metadata && result.choiceId) result.metadata[2] = result.choiceId;
      }
    }
  }

  result.sourceUrls = [...sourceUrls].slice(0, 32);
  return result;
}

/** Extract the most complete reply from a finished raw response. */
function extractReply(rawText) {
  let content = String(rawText || '');
  if (content.startsWith(")]}'")) content = content.slice(4).trimStart();

  const framed = parseLengthPrefixedFrames(content);
  let result = mergeReplyParts(framed.parts);
  if (result.text || result.images?.length || result.errorCode) return result;

  // Old-response fallback.
  const fallbackParts = [];
  for (const frame of scanFrames(content)) fallbackParts.push(frame);
  result = mergeReplyParts(fallbackParts, result);
  return result;
}

/* ------------------------------------------------------------------ */
/* Response cleanup                                                    */
/* ------------------------------------------------------------------ */

/**
 * When Gemini thinks it produced a file/attachment, it appends a link like
 * `http://googleusercontent.com/lmdx_content/…` to the end of the reply. That's
 * not a real address — it's an internal placeholder shown as a card in Gemini's
 * own UI. On our site it looks like a dead link, so it's removed.
 *
 * Only addresses containing `googleusercontent.com` without a subdomain plus
 * `/lmdx_content/` are removed; real image addresses like
 * `lh3.googleusercontent.com` are preserved.
 */
function sanitizeReply(text) {
  const cleaned = text
    .replace(/\[([^\]]*)\]\(\s*https?:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\/lmdx_content\/[^\s)]*\)/gi, '$1')
    .replace(/https?:\/\/googleusercontent\.com\/[^\s)"'<]*/gi, '')
    .replace(/https?:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\/lmdx_content\/[^\s)"'<]*/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return sanitizeProviderLinks(cleaned);
}

/* ------------------------------------------------------------------ */
/* Stream reading                                                      */
/* ------------------------------------------------------------------ */

/**
 * Reads the response body piece by piece.
 *
 * Google sometimes doesn't close the connection after finishing the response;
 * with `res.text()` the request would hang for minutes. So we watch the data
 * stream: as long as the reply keeps "growing" (Gemini re-sends the completed
 * reply repeatedly, each time slightly longer) we keep waiting — long code
 * outputs can have long silences between chunks, and we don't get stuck on
 * those. Only when the reply stops changing (meaning generation is done) do we
 * wait out the silence threshold and close the connection ourselves. No content
 * is lost.
 */
async function readStreamBody(res, { signal, idleMs = IDLE_TIMEOUT_MS, timeoutMs = REQUEST_TIMEOUT_MS, onProgress = null }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let rawText = '';
  let frameBuffer = '';
  let antiXssiHandled = false;
  let liveReply = { text: '', conversationId: '', responseId: '', choiceId: '', errorCode: null, images: [] };
  let lastChunkAt = Date.now();
  let stableSince = 0;
  const startedAt = Date.now();

  const publishParts = (parts) => {
    if (!parts?.length) return;
    // A single TCP read can contain several Gemini frames. Publish them one by
    // one instead of collapsing the whole read into only its final state.
    for (const item of normalizeWrbParts(parts)) {
      const previousText = liveReply.text;
      const previousImageCount = Array.isArray(liveReply.images) ? liveReply.images.length : 0;
      liveReply = mergeReplyParts([item], liveReply);
      const imageCountChanged = (Array.isArray(liveReply.images) ? liveReply.images.length : 0) !== previousImageCount;
      if ((liveReply.text && liveReply.text !== previousText) || imageCountChanged) {
        stableSince = Date.now();
        if (typeof onProgress === 'function' && liveReply.text && liveReply.text !== previousText) {
          try { onProgress(liveReply.text); } catch { /* progress callback must be non-fatal */ }
        }
      }
    }
  };

  const parseAvailableFrames = () => {
    // The anti-XSSI prefix can itself be split over TCP chunks. Wait until we
    // have enough bytes to decide once, then remove it exactly once.
    if (!antiXssiHandled) {
      if (frameBuffer.length < 4 && ")]}'".startsWith(frameBuffer)) return;
      if (frameBuffer.startsWith(")]}'")) frameBuffer = frameBuffer.slice(4).trimStart();
      antiXssiHandled = true;
    }

    for (;;) {
      const before = frameBuffer.length;
      const parsed = parseLengthPrefixedFrames(frameBuffer);
      frameBuffer = parsed.rest;
      publishParts(parsed.parts);
      if (!parsed.parts.length || frameBuffer.length === before) break;
    }
  };

  const watchdog = setInterval(() => {
    const silence = Date.now() - lastChunkAt;
    const stalled = !rawText && silence > FIRST_BYTE_TIMEOUT_MS;
    const finished = (liveReply.text || liveReply.images?.length) && stableSince && Date.now() - stableSince > idleMs;
    // Provider error frames (notably error 13) are terminal for this attempt.
    // Do not keep the HTTP stream open until the full request timeout after an
    // explicit upstream rejection; the caller can refresh the session and retry.
    const rejected = Number.isFinite(Number(liveReply.errorCode)) && Number(liveReply.errorCode) > 0 && silence > 350;
    const tookTooLong = Date.now() - startedAt > timeoutMs;
    if (stalled || finished || rejected || tookTooLong) reader.cancel().catch(() => {});
  }, 250);

  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal?.aborted) throw err;
        break;
      }
      if (chunk.done) break;
      const decoded = decoder.decode(chunk.value, { stream: true });
      if (!decoded) continue;
      rawText += decoded;
      frameBuffer += decoded;
      lastChunkAt = Date.now();
      // Deliberately no time throttle: every complete Gemini transport frame is
      // parsed and published in the same event-loop turn it is received.
      parseAvailableFrames();
    }

    const tail = decoder.decode();
    if (tail) {
      rawText += tail;
      frameBuffer += tail;
      parseAvailableFrames();
    }
  } catch (err) {
    if (signal?.aborted) throw err;
  } finally {
    clearInterval(watchdog);
  }

  // Some older Gemini builds don't use the current length framing. Preserve the
  // old full-response parser as a final compatibility fallback, but never make
  // live rendering wait for it when framed updates are available.
  const finalReply = extractReply(rawText);
  if (typeof onProgress === 'function' && finalReply.text && finalReply.text !== liveReply.text) {
    try { onProgress(finalReply.text); } catch { /* ignore */ }
  }

  return rawText;
}

/* ------------------------------------------------------------------ */
/* Sending a message                                                   */
/* ------------------------------------------------------------------ */

/**
 * Inner request list. In normal mode the old (simple) bard format is sent — it
 * is verified to work with the current session. In thinking mode the up-to-date
 * format the gemini UI sends today is used; the thinking model is selected via
 * an HTTP header.
 */
function buildInnerRequest(prompt, model, thinking, locale = 'en', requestUuid = randomUUID().toUpperCase(), uploads = [], temporary = false, metadata = null) {
  // The current reference client builds exactly 81 fields. The older Cryox
  // transport had 97 fields plus stale tail flags; Google now rejects that
  // layout on some accounts with HTTP 400.
  const req = new Array(81).fill(null);
  const attachmentList = (Array.isArray(uploads) ? uploads : []).map((upload) => [
    [String(upload?.handle || '')],
    safeAttachmentName(upload?.name),
  ]).filter((entry) => entry[0][0]);

  req[0] = [prompt, 0, null, attachmentList.length ? attachmentList : null, null, null, 0];
  req[1] = [String(locale || 'en').slice(0, 12)];
  req[2] = normalizeChatMetadata(metadata);
  req[6] = [1];
  req[7] = 1;
  req[10] = 1;
  req[11] = 0;
  req[17] = [[0]];
  req[18] = 0;
  req[27] = 1;
  req[30] = [4];
  req[41] = [1];
  if (temporary) req[45] = 1;
  req[53] = 0;
  req[59] = requestUuid;
  req[61] = [];
  req[68] = 1;
  // Mirrored model number. Dynamic model discovery may override this in sendOnce.
  req[79] = resolveGeminiWebModelSelector(model);
  req[80] = resolveGeminiWebReasoningSelector(thinking);
  return req;
}

let streamReqId = Math.floor(Math.random() * 90000) + 10000;

async function sendOnce(prompt, { signal, model, thinking, locale, uploads = [], temporary = false, metadata = null, onProgress, timeoutMs = REQUEST_TIMEOUT_MS, idleMs = IDLE_TIMEOUT_MS } = {}) {
  const currentSession = await getSession();
  const requestLocale = String(locale || currentSession.language || 'en').slice(0, 12);
  const requestUuid = randomUUID().toUpperCase();
  const selectedModel = await resolveGeminiRuntimeModel(model || CRYOX_STORAGE_MODEL, { signal });
  const innerRequest = buildInnerRequest(prompt, model || CRYOX_STORAGE_MODEL, thinking, requestLocale, requestUuid, uploads, temporary, metadata);
  innerRequest[79] = selectedModel.modelNumber;

  // Match the current reference client's form payload: `at` and `f.req` are POST fields, not
  // guessed query parameters.
  const body = new URLSearchParams({
    at: currentSession.token || '',
    'f.req': JSON.stringify([null, JSON.stringify(innerRequest)]),
  }).toString();

  const reqid = streamReqId;
  streamReqId += 100000;
  const params = new URLSearchParams({ hl: requestLocale, _reqid: String(reqid), rt: 'c' });
  if (currentSession.build) params.set('bl', currentSession.build);
  if (currentSession.sid) params.set('f.sid', currentSession.sid);

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache',
    Cookie: activeCookieHeader(),
    Origin: 'https://gemini.google.com',
    Referer: 'https://gemini.google.com/',
    'X-Same-Domain': '1',
    'x-goog-ext-525005358-jspb': JSON.stringify([requestUuid, 1]),
    [MODEL_HEADER_KEY]: buildDynamicModelHeader(selectedModel, thinking),
    'x-goog-ext-73010989-jspb': '[0]',
    'x-goog-ext-73010990-jspb': '[0,0,0]',
    'User-Agent': UA,
  };
  if (!sendOnce._lastModelLog || sendOnce._lastModelLog !== selectedModel.modelId) {
    console.log(`[gemini-web] model locked: ${selectedModel.displayName || selectedModel.categoryName || 'Gemini Flash Lite'} (${selectedModel.modelId})`);
    sendOnce._lastModelLog = selectedModel.modelId;
  }

  let res;
  try {
    res = await browserFetch(`${STREAM_URL}?${params.toString()}`, { method: 'POST', headers, body, signal: combined, redirect: 'manual' });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new GeminiError("Gemini didn't respond in time. Could you try again?", { kind: 'timeout' });
    }
    resetSession();
    throw new GeminiError(`Could not reach Gemini: ${err?.message || 'network error'}`, { kind: 'network' });
  }

  absorbSetCookies(res.headers.getSetCookie?.() || []);
  if (res.status === 401 || res.status === 403) {
    resetSession();
    throw new GeminiError('The Gemini session is invalid or expired.', { kind: 'auth' });
  }
  if (res.status === 429) throw new GeminiError('Gemini is temporarily rate-limited. Please wait a moment.', { kind: 'rate-limit' });
  if (res.status === 400) {
    resetSession();
    throw new GeminiError('Gemini rejected the current web-session request (HTTP 400).', { kind: 'bad-request' });
  }
  if (!res.ok) throw new GeminiError(`Gemini returned an unexpected response (HTTP ${res.status}).`, { kind: 'http' });

  return extractReply(await readStreamBody(res, { signal, timeoutMs, idleMs, onProgress }));
}

async function queryOnce(cleanPrompt, { signal, model, thinking, locale, uploads = [], temporary = false, metadata = null, onProgress, timeoutMs = REQUEST_TIMEOUT_MS, idleMs = IDLE_TIMEOUT_MS } = {}) {
  let reply = null;
  // One fresh-session retry for HTTP 400, exactly where a stale SNlM0e/build
  // pair can bite after Gemini rolls its frontend.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      reply = await sendOnce(cleanPrompt, { signal, model, thinking, locale, uploads, temporary, metadata, onProgress, timeoutMs, idleMs });
      break;
    } catch (error) {
      if (error?.kind === 'bad-request' && attempt === 0 && !signal?.aborted) {
        console.warn('[gemini-web] HTTP 400; refreshing SNlM0e/build/session and retrying once.');
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }
      throw error;
    }
  }

  for (let attempt = 1; attempt <= 2 && reply && !reply.text && !reply.images?.length; attempt++) {
    if (reply.errorCode) console.warn(`[gemini-web] upstream rejected a request (error ${reply.errorCode}); refreshing session and retrying (${attempt}/2)`);
    else console.warn(`[gemini-web] empty upstream response; refreshing session and retrying (${attempt}/2)`);
    resetSession();
    await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    reply = await sendOnce(cleanPrompt, { signal, model, thinking, locale, uploads, temporary, metadata, onProgress, timeoutMs, idleMs });
  }
  return reply || { text: '', conversationId: '', responseId: '', choiceId: '', metadata: null, errorCode: null, images: [], sourceUrls: [] };
}

function assertReply(reply) {
  if (!reply.text) {
    if (reply.errorCode) {
      throw new GeminiError(
        `Gemini hit a temporary error (code ${reply.errorCode}) even after retrying. ` +
        `Send the message again — it usually goes through on the next try.`,
        { kind: 'rejected' },
      );
    }
    throw new GeminiError("Gemini returned an empty response. Could you try again?", { kind: 'empty' });
  }
}

/**
 * Sends a message to Gemini and returns the reply text. Thinking mode does not
 * go to a separate model. The same model id is used while the Gemini web request
 * carries its native reasoning-mode selector (field 80). Cryox fixes that
 * selector to HIGH whenever Thinking is enabled.
 *
 * Long chats use Gemini Web's opaque native chat metadata on subsequent turns.
 * Cryox persists that metadata per authenticated user + Cryox chat under /data.
 * If the provider invalidates the metadata, the caller can rebuild the upstream
 * thread once from the exact unsummarized transcript via `fallbackPrompt`.
 *
 * @returns {Promise<string>}
 */
async function queryGeminiWebReply({
  prompt,
  fallbackPrompt = '',
  threadKey = '',
  signal,
  model = CRYOX_STORAGE_MODEL,
  thinking = false,
  files = [],
  locale,
  temporary = false,
  onProgress,
  timeoutMs = REQUEST_TIMEOUT_MS,
  idleMs = IDLE_TIMEOUT_MS,
} = {}) {
  const cleanPrompt = String(prompt || '').trim();
  const cleanFallbackPrompt = String(fallbackPrompt || '').trim();
  if (!cleanPrompt) throw new GeminiError('Cannot send an empty message.', { kind: 'input' });
  // Storage acknowledgements are pinned to Gemini 3.5 Flash Lite using the account's
  // dynamically discovered model header, so Google's default model cannot override it.

  let threadState = threadKey ? loadGeminiThreadState(threadKey) : null;
  // Changing temporary/non-temporary mode is a provider-level new conversation.
  if (threadState && threadState.temporary !== (temporary !== false)) {
    clearGeminiThreadState(threadKey);
    threadState = null;
  }

  // Attachment upload must use the same freshly resolved web session as the
  // following generation request. Text-only turns keep their original path and
  // do not pay for any attachment setup.
  let uploads = [];
  if (Array.isArray(files) && files.length) {
    for (let uploadAttempt = 0; uploadAttempt < 2; uploadAttempt++) {
      const attachmentSession = await getSession({ force: uploadAttempt > 0 });
      try {
        uploads = await uploadGeminiAttachments(files, {
          signal,
          pushId: attachmentSession.pushId || CONTENT_PUSH_ID,
          clientPctx: attachmentSession.clientPctx || '',
          cookieHeader: activeCookieHeader(),
        });
        break;
      } catch (error) {
        const canRefresh = error?.kind === 'attachment' && error?.retryable === true && uploadAttempt === 0;
        if (!canRefresh || signal?.aborted) throw error;
        console.warn(`[attachment-upload] refreshing-session-after=${error.uploadStage || 'unknown'}`);
        resetSession();
      }
    }
  }

  async function runWithMetadata(requestPrompt, metadata, requestUploads = uploads, progress = onProgress, requestTemporary = temporary) {
    if (requestUploads.length <= GEMINI_ATTACHMENTS_PER_TURN) {
      const reply = await queryOnce(requestPrompt, {
        signal, model, thinking, locale, uploads: requestUploads,
        temporary: requestTemporary, metadata, onProgress: progress, timeoutMs, idleMs,
      });
      assertReply(reply);
      return reply;
    }

    // Attachment batching is analysis-only and intentionally does not mutate the
    // main conversation until the final synthesis turn.
    const summaries = [];
    for (let index = 0; index < requestUploads.length; index += GEMINI_ATTACHMENTS_PER_TURN) {
      const batch = requestUploads.slice(index, index + GEMINI_ATTACHMENTS_PER_TURN);
      const batchPrompt = `${requestPrompt}\n\n[CRYOX_ATTACHMENT_BATCH ${Math.floor(index / GEMINI_ATTACHMENTS_PER_TURN) + 1}]\nAnalyze only the attached files for the user's request. Return a dense factual working summary preserving filenames, exact values, code details, and uncertainties. Do not answer the user yet.`;
      const partial = await queryOnce(batchPrompt, {
        signal, model, thinking, locale, uploads: batch, temporary: true,
        metadata: null, timeoutMs: Math.max(timeoutMs, 120_000), idleMs,
      });
      assertReply(partial);
      summaries.push(partial.text);
    }
    const synthesisPrompt = `${requestPrompt}\n\n[CRYOX_ATTACHMENT_BATCH_SUMMARIES]\n${summaries.map((text, i) => `Batch ${i + 1}:\n${text}`).join('\n\n')}\n[END_CRYOX_ATTACHMENT_BATCH_SUMMARIES]\nAnswer the original user request using all batch summaries.`;
    const reply = await queryOnce(synthesisPrompt, {
      signal, model, thinking, locale, uploads: [], temporary: requestTemporary,
      metadata, onProgress: progress, timeoutMs: Math.max(timeoutMs, 120_000), idleMs,
    });
    assertReply(reply);
    return reply;
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let reply;
      try {
        reply = await runWithMetadata(cleanPrompt, threadState?.metadata || null);
      } catch (threadError) {
        // If an old provider metadata blob becomes invalid after a Gemini Web
        // rollout, restart only that upstream thread and bootstrap it from the
        // exact Cryox transcript. No summarization/compression is performed.
        if (!threadState || !cleanFallbackPrompt || signal?.aborted) throw threadError;
        console.warn('[gemini-thread] native continuation failed; rebuilding from exact transcript.');
        clearGeminiThreadState(threadKey);
        threadState = null;
        reply = await runWithMetadata(cleanFallbackPrompt, null);
      }

      if (threadKey && Array.isArray(reply?.metadata) && reply.metadata[0]) {
        saveGeminiThreadState(threadKey, reply.metadata, temporary);
      }
      return reply;
    } catch (err) {
      lastError = err;
      if (signal?.aborted || err?.kind !== 'network' || attempt > 0) throw err;
      resetSession();
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError || new GeminiError('Gemini could not complete the response.', { kind: 'network' });
}

/**
 * Detailed Gemini Web reply used by Cryox's optional signed-in search bridge.
 * Ordinary chat continues to call queryGeminiWeb() and receives only text.
 */
export async function queryGeminiWebDetailed(options = {}) {
  const reply = await queryGeminiWebReply(options);
  return {
    text: sanitizeReply(reply.text),
    sourceUrls: Array.isArray(reply.sourceUrls) ? reply.sourceUrls.slice(0, 32) : [],
    conversationId: String(reply.conversationId || ''),
    responseId: String(reply.responseId || ''),
    choiceId: String(reply.choiceId || ''),
    metadata: Array.isArray(reply.metadata) ? normalizeChatMetadata(reply.metadata) : null,
  };
}

export async function queryGeminiWeb(options = {}) {
  const reply = await queryGeminiWebReply(options);
  return sanitizeReply(reply.text);
}

/**
 * Minimal batchexecute bridge used by Cryox's Gemini-backed remote workspace.
 * These RPC ids are internal Gemini Web implementation details and may change;
 * callers must always treat failures as recoverable provider failures.
 */
async function geminiBatchExecute(rpcid, payload, { signal, timeoutMs = 45_000 } = {}) {
  const { token, build, sid } = await getSession();
  const requestLocale = 'en';
  const encodedPayload = JSON.stringify(payload);
  const fReq = JSON.stringify([[[String(rpcid), encodedPayload, null, 'generic']]]);
  const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(token)}`;
  const url =
    `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=${encodeURIComponent(rpcid)}` +
    `&source-path=%2Fapp&bl=${encodeURIComponent(build)}` +
    `&hl=${requestLocale}&_reqid=${Math.floor(Math.random() * 900_000 + 100_000)}&rt=c` +
    (sid ? `&f.sid=${encodeURIComponent(sid)}` : '');
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await browserFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      Cookie: activeCookieHeader(),
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/app',
      'X-Same-Domain': '1',
      'User-Agent': UA,
    },
    body,
    signal: combined,
  });
  absorbSetCookies(response.headers.getSetCookie?.() || []);
  if (response.status === 401 || response.status === 403) {
    resetSession();
    throw new GeminiError('Gemini history access was rejected by the signed-in session.', { kind: 'auth' });
  }
  if (!response.ok) throw new GeminiError(`Gemini history request failed (HTTP ${response.status}).`, { kind: 'http' });
  let text = await response.text();
  if (text.startsWith(")]}'")) text = text.slice(4).trimStart();
  const parsed = parseLengthPrefixedFrames(text);
  const parts = parsed.parts.length ? parsed.parts : scanFrames(text);
  // Keep parsed array frames; parseRpcBodies() performs the exact RPC-id match recursively.
  return normalizeWrbParts(parts).filter((part) => Array.isArray(part));
}

function parseRpcBodies(parts, rpcid) {
  const bodies = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (value[0] === 'wrb.fr' && String(value[1] || '') === String(rpcid) && typeof value[2] === 'string') {
      try { bodies.push(JSON.parse(value[2])); } catch { /* malformed provider body */ }
    }
    for (const child of value) if (Array.isArray(child)) walk(child);
  };
  for (const part of Array.isArray(parts) ? parts : []) walk(part);
  return bodies;
}

function readNested(value, path, fallback = null) {
  let current = value;
  for (const key of path) {
    if (!Array.isArray(current) || key < 0 || key >= current.length) return fallback;
    current = current[key];
  }
  return current == null ? fallback : current;
}

function computeModelCapacity(tierFlags, capabilityFlags) {
  const tiers = Array.isArray(tierFlags) ? tierFlags : [];
  const capabilities = Array.isArray(capabilityFlags) ? capabilityFlags : [];
  if (tiers.includes(21)) return { capacity: 1, capacityField: 13 };
  if (tiers.includes(22)) return { capacity: 2, capacityField: 13 };
  if (capabilities.includes(115)) return { capacity: 4, capacityField: 12 };
  if (tiers.includes(16) || capabilities.includes(106)) return { capacity: 3, capacityField: 12 };
  if (tiers.includes(8) || capabilities.includes(19)) return { capacity: 2, capacityField: 12 };
  return { capacity: 1, capacityField: 12 };
}

function normalizeModelText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_.]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseAvailableModel(modelData, capacity, capacityField) {
  if (!Array.isArray(modelData)) return null;
  const modelId = String(readNested(modelData, [0], '') || '');
  if (!modelId) return null;
  const categoryName = String(readNested(modelData, [1], '') || readNested(modelData, [10], '') || '');
  const displayName = String(readNested(modelData, [11], '') || readNested(modelData, [19], '') || categoryName || '');
  const description = String(readNested(modelData, [12], '') || readNested(modelData, [2], '') || '');
  const n17 = readNested(modelData, [17], null);
  const n9 = readNested(modelData, [9], null);
  const modelNumber = Number.isInteger(n17) ? n17 : (Number.isInteger(n9) ? n9 : 1);
  const searchText = normalizeModelText([categoryName, displayName, description, modelId].join(' '));
  return { modelId, categoryName, displayName, description, modelNumber, capacity, capacityField, searchText };
}

async function discoverGeminiModels({ signal, force = false } = {}) {
  if (!force && modelDiscoveryCache.models.length && Date.now() - modelDiscoveryCache.time < SESSION_TTL_MS) {
    return modelDiscoveryCache.models;
  }
  const parts = await geminiBatchExecute('otAQ7b', [], { signal });
  const bodies = parseRpcBodies(parts, 'otAQ7b');
  for (const body of bodies) {
    const modelsList = readNested(body, [15], null);
    if (!Array.isArray(modelsList)) continue;
    const { capacity, capacityField } = computeModelCapacity(readNested(body, [16], []), readNested(body, [17], []));
    const models = modelsList.map((item) => parseAvailableModel(item, capacity, capacityField)).filter(Boolean);
    if (models.length) {
      modelDiscoveryCache = { models, time: Date.now() };
      return models;
    }
  }
  throw new GeminiError('Gemini model list could not be discovered for this account.', { kind: 'model' });
}

function buildDynamicModelHeader(selected, thinking) {
  const header = [1, null, null, null, selected.modelId, null, null, 0, [4, 5, 6, 8], null, null];
  if (selected.capacityField === 13) {
    header.push(null, selected.capacity, null, null, selected.modelNumber);
  } else {
    header.push(selected.capacity, null, null, selected.modelNumber);
  }
  header.push(thinking ? 2 : 1);
  header.push(modelSessionId);
  return JSON.stringify(header);
}

async function resolveGeminiRuntimeModel(targetModel, { signal } = {}) {
  const target = normalizeModelText(targetModel || CRYOX_STORAGE_MODEL);
  const models = await discoverGeminiModels({ signal });

  // Prefer an exact 3.5 + Flash Lite match. Model RPC naming varies by rollout,
  // so we inspect both the category and the display/version text.
  let selected = models.find((m) => {
    const text = m.searchText;
    return text.includes('flash-lite') && (text.includes('3-5') || text.includes('3.5'));
  });

  // Then match the requested name/aliases semantically.
  if (!selected) {
    selected = models.find((m) => {
      const text = m.searchText;
      return text.includes(target) || (target.includes('flash-lite') && text.includes('flash-lite'));
    });
  }

  if (!selected) {
    const visible = models.map((m) => m.displayName || m.categoryName || m.modelId).filter(Boolean).join(', ');
    throw new GeminiError(`Gemini 3.5 Flash Lite is not available on this account. Available models: ${visible || 'unknown'}`, { kind: 'model' });
  }
  return selected;
}

export async function listGeminiChats({ recent = 1000, signal } = {}) {
  const limit = Math.max(1, Math.min(5000, Number(recent) || 1000));
  const payloads = [
    [limit, null, [1, null, 1]],
    [limit, null, [0, null, 1]],
    [limit],
  ];
  const byId = new Map();
  let lastError = null;
  for (const payload of payloads) {
    try {
      const parts = await geminiBatchExecute('MaZiqc', payload, { signal });
      for (const body of parseRpcBodies(parts, 'MaZiqc')) {
        const chats = Array.isArray(body?.[2]) ? body[2] : [];
        for (const row of chats) {
          if (!Array.isArray(row) || !row[0]) continue;
          const stamp = Array.isArray(row[5]) ? Number(row[5][0] || 0) * 1000 + Number(row[5][1] || 0) / 1e6 : 0;
          byId.set(String(row[0]), {
            conversationId: String(row[0]),
            title: String(row[1] || ''),
            pinned: Boolean(row[2]),
            updatedAt: Math.max(0, stamp),
          });
        }
      }
      if (byId.size) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!byId.size && lastError) throw lastError;
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readGeminiChat({ conversationId, limit = 10, signal } = {}) {
  const cid = String(conversationId || '').trim();
  if (!/^c_[A-Za-z0-9_-]+$/.test(cid)) throw new GeminiError('Invalid Gemini conversation id.', { kind: 'input' });
  const requestedLimit = Math.max(1, Math.min(2000, Number(limit) || 10));
  const limits = [...new Set([requestedLimit, Math.min(100, requestedLimit)])];
  const payloads = limits.flatMap((pageSize) => [
    [cid, pageSize, null, 1, [1], [4], null, 1],
    [cid, pageSize, null, 1, [0], [4], null, 1],
  ]);
  let lastError = null;
  for (const payload of payloads) {
    try {
      const parts = await geminiBatchExecute('hNvQHb', payload, { signal });
      const bodies = parseRpcBodies(parts, 'hNvQHb');
      for (const body of bodies) {
        const turns = Array.isArray(body?.[0]) ? body[0] : [];
        if (!turns.length) continue;
        return turns.map((turn) => ({
          user: String(turn?.[2]?.[0]?.[0] || ''),
          model: Array.isArray(turn?.[3]?.[0]?.[0]?.[1]) ? turn[3][0][0][1].filter((v) => typeof v === 'string').join('') : '',
          raw: turn,
        }));
      }
      return [];
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

export async function deleteGeminiChat({ conversationId, signal } = {}) {
  const cid = String(conversationId || '').trim();
  if (!/^c_[A-Za-z0-9_-]+$/.test(cid)) return false;
  // GzXR5e is the long-lived first deletion RPC. Gemini has changed the
  // secondary cleanup RPC across builds, so we intentionally make deletion
  // best-effort and never make workspace writes depend on it.
  try {
    await geminiBatchExecute('GzXR5e', [cid], { signal });
    return true;
  } catch {
    return false;
  }
}



/**
 * Fetches a previously uploaded Gemini attachment handle through the same
 * authenticated Google session. This is intentionally server-only: callers
 * never receive Gemini cookies and arbitrary URLs are rejected by
 * cleanUploadHandle().
 */
export async function fetchGeminiUploadedHandle(handle, { signal, timeoutMs = 120_000 } = {}) {
  const clean = cleanUploadHandle(handle);
  if (!clean) throw new GeminiError('Invalid Gemini attachment handle.', { kind: 'input' });
  let target;
  try { target = new URL(clean); } catch {
    throw new GeminiError('This Gemini attachment does not expose a downloadable URL.', { kind: 'attachment' });
  }
  const timeout = AbortSignal.timeout(Math.max(5_000, Math.min(30 * 60_000, Number(timeoutMs) || 120_000)));
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await browserFetch(target, {
    method: 'GET',
    headers: {
      Accept: '*/*',
      Cookie: activeCookieHeader(),
      Referer: 'https://gemini.google.com/',
      Origin: 'https://gemini.google.com',
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: combined,
  });
  absorbSetCookies(response.headers.getSetCookie?.() || []);
  if (response.status === 401 || response.status === 403) {
    resetSession();
    throw new GeminiError('Gemini rejected the attachment download. Refresh your session cookies.', { kind: 'auth' });
  }
  if (!response.ok || !response.body) {
    throw new GeminiError(`Gemini attachment download failed (HTTP ${response.status}).`, { kind: 'http' });
  }
  return response;
}

/** Warms up the connection ahead of time — for /api/health. */
export async function warmupGemini() {
  await getSession();
  return true;
}

export const _geminiWebTest = {
  buildInnerRequest,
  cleanUploadClientPctx,
  cleanUploadHandle,
  normalizeGeminiAttachments,
  uploadGeminiAttachments,
};
