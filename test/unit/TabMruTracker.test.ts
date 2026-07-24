import assert from 'node:assert/strict';
import test from 'node:test';
import { TabMruTracker } from '../../src/tabs/TabMruTracker';

test('tracks focus transitions across tabs with strictly increasing activation times', () => {
  const tracker = new TabMruTracker<object>(() => 100);
  const first = {};
  const second = {};

  assert.equal(tracker.observeFocused(undefined), false);
  assert.equal(tracker.observeFocused(first), true);
  assert.equal(tracker.lastActivatedAt(first), 100);

  assert.equal(tracker.observeFocused(first), false);
  assert.equal(tracker.lastActivatedAt(first), 100);

  assert.equal(tracker.observeFocused(second), true);
  assert.equal(tracker.lastActivatedAt(second), 101);
  assert.equal(tracker.lastActivatedAt(first), 100);
});

test('puts focus departures between repeated activations and leaves unseen tabs unranked', () => {
  let now = 200;
  const tracker = new TabMruTracker<object>(() => now);
  const visited = {};
  const openedInBackground = {};

  tracker.observeFocused(visited);
  tracker.observeFocused(undefined);
  now = 250;
  assert.equal(tracker.observeFocused(visited), true);

  assert.equal(tracker.lastActivatedAt(visited), 250);
  assert.equal(tracker.lastActivatedAt(openedInBackground), undefined);
});

test('records explicitly verified activations even when the focused tab is unchanged', () => {
  let now = 300;
  const tracker = new TabMruTracker<object>(() => now);
  const tab = {};

  tracker.observeFocused(tab);
  now = 350;
  assert.equal(tracker.recordSuccessfulActivation(tab), 350);
  assert.equal(tracker.lastActivatedAt(tab), 350);
});
