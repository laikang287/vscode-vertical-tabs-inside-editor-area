import assert from 'node:assert/strict';
import test from 'node:test';
import { ActiveTabFollowTracker } from '../../src/webview/ActiveTabFollowTracker';
import type { TabTarget } from '../../src/webview/messages';

const firstTarget: TabTarget = {
  revision: 1,
  groupIndex: 0,
  tabIndex: 0,
  identity: { kind: 'text', uri: 'file:///workspace/first.ts' },
};
const secondTarget: TabTarget = {
  revision: 2,
  groupIndex: 0,
  tabIndex: 1,
  identity: { kind: 'text', uri: 'file:///workspace/second.ts' },
};

test('follows the initial focused tab and only follows again after navigation', () => {
  const tracker = new ActiveTabFollowTracker();

  assert.equal(tracker.shouldFollow(firstTarget, true), true);
  assert.equal(tracker.shouldFollow({ ...firstTarget, revision: 2, tabIndex: 4 }, true), false);
  assert.equal(tracker.shouldFollow(secondTarget, true), true);
  assert.equal(tracker.shouldFollow(secondTarget, true), false);
});

test('tracks navigation while disabled and follows once when re-enabled', () => {
  const tracker = new ActiveTabFollowTracker();

  assert.equal(tracker.shouldFollow(firstTarget, false), false);
  assert.equal(tracker.shouldFollow(secondTarget, false), false);
  assert.equal(tracker.shouldFollow(secondTarget, true), true);
  assert.equal(tracker.shouldFollow(secondTarget, true), false);
});

test('treats the same resource in another editor group as a new active location', () => {
  const tracker = new ActiveTabFollowTracker();

  assert.equal(tracker.shouldFollow(firstTarget, true), true);
  assert.equal(tracker.shouldFollow({ ...firstTarget, revision: 3, groupIndex: 1 }, true), true);
  assert.equal(tracker.shouldFollow(undefined, true), false);
});
