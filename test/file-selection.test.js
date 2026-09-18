import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotFiles } from '../public/js/file-selection.js';

test('snapshots a live file collection before the input is cleared', () => {
  const selected = [{ name: 'archive.zip', size: 4096 }];
  const liveCollection = {
    [Symbol.iterator]: function* () {
      yield* selected;
    },
  };

  const snapshot = snapshotFiles(liveCollection);
  selected.length = 0;

  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].name, 'archive.zip');
});

test('returns an empty array for a missing selection', () => {
  assert.deepEqual(snapshotFiles(null), []);
});
