import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const indexFile = path.join(config.dataDir, 'vault-index.json');
const stateFile = path.join(config.dataDir, 'vault-state.json');
const historyScanFile = path.join(config.dataDir, 'history-scan.json');
const hiddenFile = path.join(config.dataDir, 'vault-hidden.json');
const cacheDir = path.join(config.dataDir, 'vault-cache');

fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function cachePathForId(id) {
  const normalized = String(id || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw Object.assign(new Error('Invalid file identifier.'), { kind: 'input' });
  }
  return path.join(cacheDir, `${normalized}.cvault`);
}

export function loadIndex() {
  const value = readJson(indexFile, []);
  return Array.isArray(value) ? value.filter((row) => row && row.id && row.handle && row.name) : [];
}

export function saveIndex(items) {
  writeJsonAtomic(indexFile, items.slice(-5000));
}

export function loadState() {
  return readJson(stateFile, {});
}

export function saveState(value) {
  writeJsonAtomic(stateFile, value || {});
}

export function loadHistoryScanState() {
  const value = readJson(historyScanFile, {});
  return value && typeof value === 'object'
    ? {
        conversations: value.conversations && typeof value.conversations === 'object' ? value.conversations : {},
        lastRunAt: Number(value.lastRunAt || 0),
      }
    : { conversations: {}, lastRunAt: 0 };
}

export function saveHistoryScanState(value) {
  writeJsonAtomic(historyScanFile, value || {});
}

export function loadHiddenIds() {
  const value = readJson(hiddenFile, []);
  return new Set(Array.isArray(value) ? value.map((item) => String(item || '')).filter(Boolean) : []);
}

export function saveHiddenIds(ids) {
  writeJsonAtomic(hiddenFile, [...ids].slice(-5000));
}

export function writeVaultCache(id, bytes) {
  const target = cachePathForId(id);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, Buffer.from(bytes), { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

export function readVaultCache(id) {
  try {
    return fs.readFileSync(cachePathForId(id));
  } catch {
    return null;
  }
}

export function removeVaultCache(id) {
  try {
    fs.unlinkSync(cachePathForId(id));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function hasVaultCache(id) {
  try {
    return fs.statSync(cachePathForId(id)).isFile();
  } catch {
    return false;
  }
}
