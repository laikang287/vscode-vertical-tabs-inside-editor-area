import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTabListFocusCandidate, type TabListFocusCandidate } from '../../src/tabs/TabListFocusTarget';

function candidate<T>(
  item: T,
  overrides: Partial<Omit<TabListFocusCandidate<T>, 'item'>> = {},
): TabListFocusCandidate<T> {
  return {
    item,
    activatable: true,
    groupIndex: 0,
    tabIndex: 0,
    isActiveInGroup: false,
    isActiveGroup: false,
    isLastFocusedGroup: false,
    ...overrides,
  };
}

test('editor focus selects the active tab in the active editor group', () => {
  const result = selectTabListFocusCandidate([
    candidate('older-active', { groupIndex: 0, isActiveInGroup: true, lastActivatedAt: 500 }),
    candidate('current-editor', { groupIndex: 1, isActiveInGroup: true, isActiveGroup: true, lastActivatedAt: 100 }),
  ], 'editor');

  assert.equal(result, 'current-editor');
});

test('outside focus selects the globally most recently used activatable tab', () => {
  const result = selectTabListFocusCandidate([
    candidate('active-group', { groupIndex: 0, isActiveInGroup: true, isActiveGroup: true, lastActivatedAt: 100 }),
    candidate('global-mru', { groupIndex: 1, tabIndex: 2, lastActivatedAt: 500 }),
    candidate('unavailable-newer', { groupIndex: 2, lastActivatedAt: 900, activatable: false }),
  ], 'outside');

  assert.equal(result, 'global-mru');
});

test('duplicate resources in different groups remain distinct focus candidates', () => {
  const firstOccurrence = { uri: 'file:///workspace/shared.ts', group: 0 };
  const recentOccurrence = { uri: 'file:///workspace/shared.ts', group: 1 };
  const result = selectTabListFocusCandidate([
    candidate(firstOccurrence, { groupIndex: 0, isActiveInGroup: true, lastActivatedAt: 100 }),
    candidate(recentOccurrence, { groupIndex: 1, tabIndex: 1, isActiveInGroup: true, lastActivatedAt: 200 }),
  ], 'outside');

  assert.equal(result, recentOccurrence);
});

test('uses a live preferred occurrence and falls back to MRU after that occurrence closes', () => {
  const preferred = { uri: 'file:///workspace/current.ts', group: 0 };
  const fallback = { uri: 'file:///workspace/recent.ts', group: 1 };
  const candidates = [
    candidate(preferred, { groupIndex: 0, lastActivatedAt: 100 }),
    candidate(fallback, { groupIndex: 1, lastActivatedAt: 500 }),
  ];

  assert.equal(selectTabListFocusCandidate(candidates, 'editor', preferred), preferred);
  assert.equal(selectTabListFocusCandidate(candidates.slice(1), 'editor', preferred), fallback);
});

test('falls back through the last focused group, active tabs, and the first activatable tab', () => {
  assert.equal(selectTabListFocusCandidate([
    candidate('first', { groupIndex: 0 }),
    candidate('last-group', { groupIndex: 1, isActiveInGroup: true, isLastFocusedGroup: true }),
  ], 'outside'), 'last-group');

  assert.equal(selectTabListFocusCandidate([
    candidate('first', { groupIndex: 0 }),
    candidate('group-active', { groupIndex: 1, isActiveInGroup: true }),
  ], 'outside'), 'group-active');

  assert.equal(selectTabListFocusCandidate([
    candidate('disabled', { groupIndex: 0, activatable: false }),
    candidate('first-available', { groupIndex: 1 }),
  ], 'outside'), 'first-available');
});

test('returns undefined when no activatable tabs remain', () => {
  assert.equal(selectTabListFocusCandidate([
    candidate('disabled', { activatable: false }),
  ], 'outside'), undefined);
  assert.equal(selectTabListFocusCandidate([], 'editor'), undefined);
});
