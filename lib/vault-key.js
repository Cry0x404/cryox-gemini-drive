import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './storage-paths.js';

const KEY_BYTES = 32;
let cachedKey = null;

export const DEFAULT_KEY_FILE = path.resolve(
  process.env.CRYOX_VAULT_KEY_FILE || path.join(DATA_DIR, 'vault.key'),
);

function parseHexKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return null;
  return Buffer.from(normalized, 'hex');
}

function readKeyFile(file) {
  try {
    const raw = fs.readFileSync(file);
    if (raw.length === KEY_BYTES) return Buffer.from(raw);
    return parseHexKey(raw.toString('utf8'));
  } catch {
    return null;
  }
}

function createKeyFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  let descriptor;

  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(descriptor, key);
    fs.fsyncSync(descriptor);
    return key;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const existing = readKeyFile(file);
      if (existing) return existing;
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function getVaultKey({ file = DEFAULT_KEY_FILE } = {}) {
  if (cachedKey) return Buffer.from(cachedKey);

  const environmentKey = parseHexKey(process.env.CRYOX_VAULT_KEY_HEX);
  if (environmentKey) {
    cachedKey = environmentKey;
    return Buffer.from(cachedKey);
  }

  cachedKey = readKeyFile(file) || createKeyFile(file);
  return Buffer.from(cachedKey);
}

export function resetVaultKeyCache() {
  cachedKey = null;
}
