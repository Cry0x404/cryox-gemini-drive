import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getVaultKey, resetVaultKeyCache } from '../lib/vault-key.js';

test('reuses an existing vault key instead of replacing it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-key-'));
  const file = path.join(directory, 'vault.key');
  const expected = Buffer.alloc(32, 0x5a);
  fs.writeFileSync(file, expected);

  const previous = process.env.CRYOX_VAULT_KEY_HEX;
  delete process.env.CRYOX_VAULT_KEY_HEX;
  resetVaultKeyCache();
  const actual = getVaultKey({ file });
  assert.deepEqual(actual, expected);
  assert.deepEqual(fs.readFileSync(file), expected);

  if (previous === undefined) delete process.env.CRYOX_VAULT_KEY_HEX;
  else process.env.CRYOX_VAULT_KEY_HEX = previous;
  resetVaultKeyCache();
});
