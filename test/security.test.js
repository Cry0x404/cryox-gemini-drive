import assert from 'node:assert/strict';
import test from 'node:test';
import { localRequestGuard, securityHeaders } from '../src/http/security.js';

function responseHarness() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function runGuard(headers, host = '127.0.0.1') {
  const response = responseHarness();
  let called = false;
  localRequestGuard({ host })({ headers }, response, () => {
    called = true;
  });
  return { response, called };
}

test('emits restrictive browser security headers', () => {
  const response = responseHarness();
  let called = false;
  securityHeaders({}, response, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
});

test('accepts a same-origin loopback request', () => {
  const { response, called } = runGuard({
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
    'sec-fetch-site': 'same-origin',
  });

  assert.equal(called, true);
  assert.equal(response.statusCode, 200);
});

test('rejects DNS rebinding and cross-site browser requests', () => {
  const rebound = runGuard({ host: 'attacker.example:3000' });
  assert.equal(rebound.called, false);
  assert.equal(rebound.response.statusCode, 421);

  const crossSite = runGuard({
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
    'sec-fetch-site': 'cross-site',
  });
  assert.equal(crossSite.called, false);
  assert.equal(crossSite.response.statusCode, 403);
});

test('rejects a mismatched or non-http origin', () => {
  const mismatched = runGuard({
    host: 'localhost:3000',
    origin: 'http://localhost:3001',
  });
  assert.equal(mismatched.called, false);
  assert.equal(mismatched.response.statusCode, 403);

  const wrongScheme = runGuard({
    host: 'localhost:3000',
    origin: 'https://localhost:3000',
  });
  assert.equal(wrongScheme.called, false);
  assert.equal(wrongScheme.response.statusCode, 403);
});

test('requires an explicit local marker for API mutations', async () => {
  const { mutationRequestGuard } = await import('../src/http/security.js');

  const blocked = responseHarness();
  let blockedNext = false;
  mutationRequestGuard({ method: 'POST', headers: {} }, blocked, () => {
    blockedNext = true;
  });
  assert.equal(blockedNext, false);
  assert.equal(blocked.statusCode, 403);

  const allowed = responseHarness();
  let allowedNext = false;
  mutationRequestGuard({ method: 'DELETE', headers: { 'x-cryox-request': '1' } }, allowed, () => {
    allowedNext = true;
  });
  assert.equal(allowedNext, true);
  assert.equal(allowed.statusCode, 200);
});
