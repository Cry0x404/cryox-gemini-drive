import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVaultRecord, encodeVaultRecord, STORAGE_MARKER } from '../lib/vault-record.js';

const record = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'example.txt',
  handle: '/contrib_service/ttl_1d/example',
  size: 7,
  uploadedAt: 1,
  type: 'text/plain',
};

test('round-trips a Cryox storage marker', () => {
  const message = `${STORAGE_MARKER}\n${encodeVaultRecord(record)}\n\nStorage marker only.`;
  assert.deepEqual(decodeVaultRecord(message), record);
});

test('ignores unrelated Gemini conversation content', () => {
  assert.equal(decodeVaultRecord('Here is an attachment from a normal Gemini chat.'), null);
  assert.equal(decodeVaultRecord('[some-other-marker] abcdefghijklmnopqrstuvwxyz'), null);
});

test('rejects malformed marker payloads', () => {
  assert.equal(decodeVaultRecord(`${STORAGE_MARKER}\nnot-a-valid-record-payload-1234567890`), null);
});

test('accepts records above the former application size threshold', () => {
  const large = { ...record, size: 200_000_000, envelopeSize: 210_000_000 };
  assert.deepEqual(
    decodeVaultRecord(`${STORAGE_MARKER}\n${Buffer.from(JSON.stringify(large)).toString('base64url')}`),
    large,
  );
});

test('rejects records with invalid sizes or identifiers', () => {
  assert.equal(decodeVaultRecord(`${STORAGE_MARKER}\n${Buffer.from(JSON.stringify({ ...record, size: -1 })).toString('base64url')}`), null);
  assert.equal(decodeVaultRecord(`${STORAGE_MARKER}\n${Buffer.from(JSON.stringify({ ...record, id: '../bad' })).toString('base64url')}`), null);
});
