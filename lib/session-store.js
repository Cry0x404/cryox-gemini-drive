import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './storage-paths.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE_NAME_RE = /^[A-Za-z0-9_.-]{1,120}$/;

export const DEFAULT_SESSION_FILE = path.resolve(
  process.env.CRYOX_GEMINI_SESSION_FILE ||
  path.join(DATA_DIR, 'gemini-session.json'),
);

export const DEFAULT_COOKIE_EXPORT_FILE = path.resolve(
  process.env.CRYOX_GEMINI_COOKIE_FILE ||
  path.join(PROJECT_ROOT, 'cookies.json'),
);

function emptySession() {
  return { psid: '', psidts: '', extra: {} };
}

function collectCookieEntries(value, map, depth = 0) {
  if (depth > 4 || value == null) return;

  if (Array.isArray(value)) {
    for (const item of value) collectCookieEntries(item, map, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;

  const name = String(value.name || '').trim();
  const cookieValue = String(value.value ?? '').trim();
  if (name && cookieValue && COOKIE_NAME_RE.test(name)) map[name] = cookieValue;

  for (const key of ['cookies', 'cookieStore', 'items', 'data']) {
    if (value[key] !== undefined) collectCookieEntries(value[key], map, depth + 1);
  }
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object') return emptySession();

  const map = Object.create(null);
  collectCookieEntries(value, map);

  if (!Object.keys(map).length && !Array.isArray(value)) {
    for (const [name, cookieValue] of Object.entries(value)) {
      if (!COOKIE_NAME_RE.test(name) || typeof cookieValue !== 'string') continue;
      const clean = cookieValue.trim();
      if (clean) map[name] = clean;
    }
  }

  const psid = String(value.psid || map['__Secure-1PSID'] || '').trim();
  const psidts = String(value.psidts || map['__Secure-1PSIDTS'] || '').trim();
  const extra = {};

  for (const [name, cookieValue] of Object.entries(map)) {
    if (name === '__Secure-1PSID' || name === '__Secure-1PSIDTS') continue;
    if (cookieValue) extra[name] = cookieValue;
  }

  return { psid, psidts, extra };
}

function isComplete(session) {
  return Boolean(session?.psid && session?.psidts);
}

function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { exists: true, raw, value: JSON.parse(raw), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, raw: '', value: null, error: null };
    return { exists: true, raw: '', value: null, error };
  }
}

function isBlankExport(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== 'object') return true;
  return Object.keys(value).length === 0;
}

function inspectCookieFile(file) {
  const result = readJsonFile(file);
  if (!result.exists) return { state: 'missing', session: emptySession(), error: '' };
  if (result.error) return { state: 'invalid', session: emptySession(), error: 'cookies.json is not valid JSON.' };
  if (isBlankExport(result.value)) return { state: 'empty', session: emptySession(), error: '' };

  const session = normalizeSession(result.value);
  if (!isComplete(session)) {
    return {
      state: 'invalid',
      session: emptySession(),
      error: 'cookies.json must include __Secure-1PSID and __Secure-1PSIDTS from the same Gemini browser session.',
    };
  }

  return { state: 'valid', session, error: '' };
}

function readStoredSession(file) {
  const result = readJsonFile(file);
  if (!result.exists || result.error) return emptySession();
  return normalizeSession(result.value);
}

function fromEnvironment() {
  const psid = String(process.env.CRYOX_GEMINI_PSID || '').trim();
  const psidts = String(process.env.CRYOX_GEMINI_PSIDTS || '').trim();
  return psid && psidts ? { psid, psidts, extra: {} } : null;
}

function writeMinimizedSession(session, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const current = readStoredSession(file);
  if (current.psid === session.psid && current.psidts === session.psidts) return file;

  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ psid: session.psid, psidts: session.psidts }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

export function loadGeminiSession({
  file = DEFAULT_SESSION_FILE,
  cookieFile = DEFAULT_COOKIE_EXPORT_FILE,
  persistCookieExport = true,
} = {}) {
  const env = fromEnvironment();
  if (env) return env;

  const exported = inspectCookieFile(cookieFile);
  if (exported.state === 'valid') {
    if (persistCookieExport && path.resolve(cookieFile) !== path.resolve(file)) {
      try {
        writeMinimizedSession(exported.session, file);
      } catch {
        // A read-only source directory should not prevent a valid cookie export from working.
      }
    }
    return exported.session;
  }

  // An explicitly populated but malformed export must never silently fall back
  // to an older cached session. That makes cookie errors look like auth failures.
  if (exported.state === 'invalid') return emptySession();

  const stored = readStoredSession(file);
  return isComplete(stored) ? stored : emptySession();
}

export function getGeminiSessionStatus({
  file = DEFAULT_SESSION_FILE,
  cookieFile = DEFAULT_COOKIE_EXPORT_FILE,
} = {}) {
  if (fromEnvironment()) return { configured: true, source: 'environment', error: '' };

  const exported = inspectCookieFile(cookieFile);
  if (exported.state === 'valid') return { configured: true, source: 'cookies.json', error: '' };
  if (exported.state === 'invalid') return { configured: false, source: 'cookies.json', error: exported.error };

  const stored = readStoredSession(file);
  if (isComplete(stored)) return { configured: true, source: 'local-session', error: '' };
  return { configured: false, source: exported.state === 'empty' ? 'cookies.json' : 'none', error: '' };
}

export function writeGeminiSession(value, { file = DEFAULT_SESSION_FILE } = {}) {
  const session = normalizeSession(value);
  if (!isComplete(session)) {
    throw new Error('The session must contain __Secure-1PSID and __Secure-1PSIDTS.');
  }
  return writeMinimizedSession(session, file);
}

export function isGeminiSessionConfigured(value = loadGeminiSession()) {
  return isComplete(value);
}

export const _sessionStoreTest = {
  normalizeSession,
  inspectCookieFile,
};
