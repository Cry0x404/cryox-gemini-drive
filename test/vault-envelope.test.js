import assert from 'node:assert/strict';
import test from 'node:test';
import { resetVaultKeyCache } from '../lib/vault-key.js';
import { openVaultPayload, sealVaultPayload, VAULT_FORMAT } from '../lib/vault-envelope.js';

test('round-trips an authenticated vault envelope', () => {
  process.env.CRYOX_VAULT_KEY_HEX = '11'.repeat(32);
  resetVaultKeyCache();

  const source = Buffer.from('vault regression payload');
  const sealed = sealVaultPayload(source, { name: 'sample.txt', type: 'text/plain' });
  const opened = openVaultPayload(sealed.archive);

  assert.deepEqual(opened.bytes, source);
  assert.equal(opened.meta.name, 'sample.txt');
  assert.equal(opened.meta.type, 'text/plain');
  assert.equal(opened.meta.format, VAULT_FORMAT);
});

test('rejects a modified encrypted payload', () => {
  process.env.CRYOX_VAULT_KEY_HEX = '22'.repeat(32);
  resetVaultKeyCache();

  const sealed = sealVaultPayload(Buffer.from('integrity test'));
  const tampered = Buffer.from(sealed.archive);
  const name = Buffer.from('payload.bin');
  const nameOffset = tampered.indexOf(name);
  assert.notEqual(nameOffset, -1);
  const payloadOffset = nameOffset + name.length;
  tampered[payloadOffset] ^= 0x01;
  assert.throws(() => openVaultPayload(tampered));
});

test('authenticates metadata with the encrypted payload', () => {
  process.env.CRYOX_VAULT_KEY_HEX = '33'.repeat(32);
  resetVaultKeyCache();

  const sealed = sealVaultPayload(Buffer.from('metadata integrity'), { name: 'sample.txt', type: 'text/plain' });
  const tampered = Buffer.from(sealed.archive);
  const original = Buffer.from('sample.txt');
  const replacement = Buffer.from('tamper.txt');
  const index = tampered.indexOf(original);
  assert.notEqual(index, -1);
  replacement.copy(tampered, index);
  assert.throws(() => openVaultPayload(tampered));
});
