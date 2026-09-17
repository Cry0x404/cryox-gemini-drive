import assert from 'node:assert/strict';
import test from 'node:test';
import { safeGoogleDownloadUrl } from '../src/services/provider-urls.js';

test('accepts trusted Google attachment hosts', () => {
  assert.equal(
    safeGoogleDownloadUrl('https://abc.googleusercontent.com/file?id=1'),
    'https://abc.googleusercontent.com/file?id=1',
  );
});

test('rejects lookalike hosts and credential-bearing URLs', () => {
  assert.equal(safeGoogleDownloadUrl('https://googleusercontent.com.attacker.example/file'), '');
  assert.equal(safeGoogleDownloadUrl('https://user:pass@googleusercontent.com/file'), '');
  assert.equal(safeGoogleDownloadUrl('http://googleusercontent.com/file'), '');
});
