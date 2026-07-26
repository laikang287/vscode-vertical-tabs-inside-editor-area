import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canMoveManualGroup,
  displayGroupDescendantIds,
  manualGroupDepth,
  moveManualGroup,
  normalizeManualGroups,
} from '../../src/tabs/GroupTree';
import type { ManualTabGroup } from '../../src/webview/messages';

const groups: ManualTabGroup[] = [
  { id: 'root', name: 'Root', collapsed: false },
  { id: 'child', name: 'Child', collapsed: false, parentId: 'root' },
  { id: 'leaf', name: 'Leaf', collapsed: false, parentId: 'child' },
  { id: 'peer', name: 'Peer', collapsed: false },
];

test('normalizes orphaned, cyclic, duplicate, and over-depth manual groups', () => {
  const normalized = normalizeManualGroups([
    ...groups,
    { id: 'too-deep', name: 'Too deep', collapsed: false, parentId: 'leaf' },
    { id: 'orphan', name: 'Orphan', collapsed: false, parentId: 'missing' },
    { id: 'cycle-a', name: 'A', collapsed: false, parentId: 'cycle-b' },
    { id: 'cycle-b', name: 'B', collapsed: false, parentId: 'cycle-a' },
    { id: 'root', name: 'Duplicate', collapsed: true },
  ]);

  assert.equal(normalized.filter((group) => group.id === 'root').length, 1);
  assert.equal(normalized.find((group) => group.id === 'too-deep')?.parentId, undefined);
  assert.equal(normalized.find((group) => group.id === 'orphan')?.parentId, undefined);
  assert.equal(normalized.find((group) => group.id === 'cycle-a')?.parentId, undefined);
  assert.equal(manualGroupDepth(normalized, 'leaf'), 3);
});

test('moves groups between valid parents while rejecting cycles and depth overflow', () => {
  assert.equal(canMoveManualGroup(groups, 'peer', 'root'), true);
  assert.equal(canMoveManualGroup(groups, 'root', 'leaf'), false);
  assert.equal(canMoveManualGroup(groups, 'root', 'child'), false);
  assert.equal(canMoveManualGroup(groups, 'peer', 'leaf'), false);

  const moved = moveManualGroup(groups, 'peer', 'root', 'child');
  assert.equal(moved.find((group) => group.id === 'peer')?.parentId, 'root');
  assert.ok(moved.findIndex((group) => group.id === 'peer') < moved.findIndex((group) => group.id === 'child'));
});

test('collects every descendant display group for recursive tree actions', () => {
  const displayGroups = [
    { id: 'root', title: 'Root', collapsed: false, mode: 'manual' as const, tabs: [], showHeader: true, isManual: true, isPinned: false, depth: 1 },
    { id: 'child', title: 'Child', collapsed: false, mode: 'manual' as const, tabs: [], showHeader: true, isManual: true, isPinned: false, parentId: 'root', depth: 2 },
    { id: 'leaf', title: 'Leaf', collapsed: false, mode: 'manual' as const, tabs: [], showHeader: true, isManual: true, isPinned: false, parentId: 'child', depth: 3 },
    { id: 'peer', title: 'Peer', collapsed: false, mode: 'manual' as const, tabs: [], showHeader: true, isManual: true, isPinned: false, depth: 1 },
  ];

  assert.deepEqual(Array.from(displayGroupDescendantIds(displayGroups, 'root')), ['child', 'leaf']);
});
