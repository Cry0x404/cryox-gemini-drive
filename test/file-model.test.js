import assert from 'node:assert/strict';
import test from 'node:test';
import { filterFiles, sortFiles, summarizeFiles, viewLabel } from '../public/js/file-model.js';

const now = Date.UTC(2026, 8, 17);
const files = [
  { id: '1', name: 'Zeta.pdf', size: 200, uploadedAt: now - 2_000, downloadReady: true },
  { id: '2', name: 'alpha.zip', size: 900, uploadedAt: now - 40 * 24 * 60 * 60 * 1000, downloadReady: false },
  { id: '3', name: 'notes.txt', size: 100, uploadedAt: now - 10_000, downloadReady: true },
];

test('summarizes vault data and availability', () => {
  assert.deepEqual(summarizeFiles(files), { count: 3, totalSize: 1200, readyCount: 2 });
});

test('filters by search, recent window, and availability', () => {
  assert.deepEqual(filterFiles(files, { query: 'ZIP', now }).map((file) => file.id), ['2']);
  assert.deepEqual(filterFiles(files, { view: 'recent', now }).map((file) => file.id), ['1', '3']);
  assert.deepEqual(filterFiles(files, { view: 'available', now }).map((file) => file.id), ['1', '3']);
});

test('sorts without mutating the original array', () => {
  assert.deepEqual(sortFiles(files, 'name').map((file) => file.name), ['alpha.zip', 'notes.txt', 'Zeta.pdf']);
  assert.deepEqual(sortFiles(files, 'size').map((file) => file.id), ['2', '1', '3']);
  assert.equal(files[0].id, '1');
});

test('returns stable view labels', () => {
  assert.equal(viewLabel('all'), 'All files');
  assert.equal(viewLabel('recent'), 'Recent');
  assert.equal(viewLabel('available'), 'Ready to download');
});
