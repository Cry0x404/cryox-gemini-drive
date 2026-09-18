import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../lib/storage-paths.js';

const root = path.dirname(fileURLToPath(new URL('../server.js', import.meta.url)));

export const config = Object.freeze({
  root,
  publicDir: path.join(root, 'public'),
  dataDir: DATA_DIR,
  host: String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1',
  port: Math.max(1, Number(process.env.PORT) || 3000),
  threadKey: 'cryox-gemini-drive-v2-protocol81',
  historyChatLimit: 5000,
  historyTurnLimit: 1000,
  historyConcurrency: 3,
});
