import assert from 'node:assert/strict';
import test from 'node:test';
import { LatestRefreshGate, shouldAcceptSnapshotRevision } from '../../src/webview/SnapshotFreshness';

test('only the latest overlapping refresh request remains current', () => {
  const gate = new LatestRefreshGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('accepts retry and newer revisions but rejects an older snapshot', () => {
  assert.equal(shouldAcceptSnapshotRevision(undefined, 1), true);
  assert.equal(shouldAcceptSnapshotRevision(4, 4), true);
  assert.equal(shouldAcceptSnapshotRevision(4, 5), true);
  assert.equal(shouldAcceptSnapshotRevision(4, 3), false);
});
