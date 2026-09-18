import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(__dirname, '..');

function platformStorageRoot() {
  if (process.env.CRYOX_STORAGE_ROOT) return path.resolve(process.env.CRYOX_STORAGE_ROOT);

  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
    return path.join(base, 'Cryox', 'GeminiDrive');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cryox Gemini Drive');
  }

  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'cryox-gemini-drive');
}

export const STORAGE_ROOT = path.resolve(platformStorageRoot());
export const DATA_DIR = path.join(STORAGE_ROOT, 'data');
export const GEMINI_THREAD_DIR = path.join(STORAGE_ROOT, 'gemini-threads');

function copyFileIfMissing(source, target) {
  try {
    if (!fs.statSync(source).isFile() || fs.existsSync(target)) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(target, 0o600); } catch { /* Windows may ignore POSIX modes. */ }
    return true;
  } catch {
    return false;
  }
}

function copyDirectoryIfMissing(sourceDir, targetDir) {
  let copied = 0;
  let entries = [];
  try { entries = fs.readdirSync(sourceDir, { withFileTypes: true }); } catch { return 0; }
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copied += copyDirectoryIfMissing(source, target);
    else if (entry.isFile() && copyFileIfMissing(source, target)) copied += 1;
  }
  return copied;
}

/**
 * Moves forward state created by pre-0.2 builds that stored runtime data next
 * to the source tree. Existing persistent state always wins; nothing is deleted.
 */
export function migrateProjectLocalStorage() {
  if (path.resolve(STORAGE_ROOT) === path.resolve(PROJECT_ROOT)) return { copied: 0 };

  let copied = 0;
  const legacyData = path.join(PROJECT_ROOT, 'data');
  const legacyThreads = path.join(PROJECT_ROOT, 'gemini-threads');

  for (const name of ['gemini-session.json', 'vault.key', 'vault-index.json', 'vault-state.json', 'history-scan.json']) {
    if (copyFileIfMissing(path.join(legacyData, name), path.join(DATA_DIR, name))) copied += 1;
  }
  copied += copyDirectoryIfMissing(path.join(legacyData, 'vault-cache'), path.join(DATA_DIR, 'vault-cache'));
  copied += copyDirectoryIfMissing(legacyThreads, GEMINI_THREAD_DIR);
  return { copied };
}

export function ensureStorageDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(GEMINI_THREAD_DIR, { recursive: true, mode: 0o700 });
}

ensureStorageDirectories();
migrateProjectLocalStorage();
