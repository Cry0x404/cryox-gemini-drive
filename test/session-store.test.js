import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getGeminiSessionStatus, loadGeminiSession, writeGeminiSession } from '../lib/session-store.js';

function cookieExport(psid = 'psid-value', psidts = 'psidts-value') {
  return [
    { domain: '.gemini.google.com', name: '__Secure-1PSID', value: psid },
    { domain: '.gemini.google.com', name: '__Secure-1PSIDTS', value: psidts },
    { domain: '.google.com', name: 'NID', value: 'auxiliary-cookie' },
  ];
}

test('loads required and auxiliary cookies from a browser export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-session-'));
  const file = path.join(dir, 'cookies.json');
  fs.writeFileSync(file, JSON.stringify(cookieExport()));
  const session = loadGeminiSession({ file, cookieFile: file, persistCookieExport: false });
  assert.equal(session.psid, 'psid-value');
  assert.equal(session.psidts, 'psidts-value');
  assert.equal(session.extra.NID, 'auxiliary-cookie');
});

test('loads cookies from wrapper exports used by browser extensions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-session-'));
  const file = path.join(dir, 'cookies.json');
  fs.writeFileSync(file, JSON.stringify({ cookies: cookieExport('wrapper-a', 'wrapper-b') }));
  const session = loadGeminiSession({ file, cookieFile: file, persistCookieExport: false });
  assert.equal(session.psid, 'wrapper-a');
  assert.equal(session.psidts, 'wrapper-b');
  assert.equal(session.extra.NID, 'auxiliary-cookie');
});

test('prefers cookies.json and persists a minimized private session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-session-'));
  const cookieFile = path.join(dir, 'cookies.json');
  const file = path.join(dir, 'private', 'gemini-session.json');
  fs.writeFileSync(cookieFile, JSON.stringify(cookieExport('root-a', 'root-b')));

  const session = loadGeminiSession({ file, cookieFile });
  assert.equal(session.psid, 'root-a');
  assert.equal(session.psidts, 'root-b');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { psid: 'root-a', psidts: 'root-b' });
});

test('falls back to the private session when cookies.json is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-session-'));
  const cookieFile = path.join(dir, 'cookies.json');
  const file = path.join(dir, 'gemini-session.json');
  fs.writeFileSync(cookieFile, '[]');
  fs.writeFileSync(file, JSON.stringify({ psid: 'stored-a', psidts: 'stored-b' }));

  const session = loadGeminiSession({ file, cookieFile });
  assert.equal(session.psid, 'stored-a');
  assert.equal(session.psidts, 'stored-b');
});

test('does not hide an invalid populated cookies.json behind a stale cached session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-session-'));
  const cookieFile = path.join(dir, 'cookies.json');
  const file = path.join(dir, 'gemini-session.json');
  fs.writeFileSync(cookieFile, JSON.stringify([{ name: '__Secure-1PSID', value: 'only-one-cookie' }]));
  fs.writeFileSync(file, JSON.stringify({ psid: 'stale-a', psidts: 'stale-b' }));

  const session = loadGeminiSession({ file, cookieFile });
  assert.equal(session.psid, '');
  assert.equal(session.psidts, '');
  const status = getGeminiSessionStatus({ file, cookieFile });
  assert.match(status.error, /__Secure-1PSIDTS/);
});

test('writes a minimized local session file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryox-session-'));
  const file = path.join(dir, 'session.json');
  writeGeminiSession(cookieExport('a', 'b'), { file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { psid: 'a', psidts: 'b' });
});
