import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjacentCyclicIndex,
  adjacentDisplayedGroup,
  adjacentDisplayedTabTarget,
  moveItemsOneStep,
  planDisplayedTabMove,
  selectedDisplayedTabsInAnchorGroup,
} from '../../src/tabs/TabCommands';
import type {
  TabTarget,
  VerticalTabDisplayGroup,
  VerticalTabItem,
  VerticalTabsSnapshot,
} from '../../src/webview/messages';

test('adjacent cyclic navigation wraps in both directions', () => {
  assert.equal(adjacentCyclicIndex(4, 0, -1), 3);
  assert.equal(adjacentCyclicIndex(4, 3, 1), 0);
  assert.equal(adjacentCyclicIndex(4, -1, -1), 3);
  assert.equal(adjacentCyclicIndex(4, -1, 1), 0);
  assert.equal(adjacentCyclicIndex(0, -1, 1), -1);
});

test('moves non-contiguous selections one position without changing their relative order', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];

  assert.deepEqual(moveItemsOneStep(order, ['b', 'd', 'e'], -1), ['b', 'a', 'd', 'e', 'c', 'f']);
  assert.deepEqual(moveItemsOneStep(order, ['b', 'c', 'e'], 1), ['a', 'd', 'b', 'c', 'f', 'e']);
});

test('does not move a selected block beyond a group boundary', () => {
  const order = ['a', 'b', 'c', 'd'];

  assert.deepEqual(moveItemsOneStep(order, ['a', 'b'], -1), order);
  assert.deepEqual(moveItemsOneStep(order, ['c', 'd'], 1), order);
});

test('navigates by vertical display groups and order instead of native snapshot order', () => {
  const a = displayedTab('a', 0, 0);
  const b = displayedTab('b', 0, 1);
  const c = displayedTab('c', 1, 0);
  const unsupported = displayedTab('unsupported', 1, 1, { isActivatable: false });
  const snapshot = displayedSnapshot(
    [a, b, c, unsupported],
    [
      displayedGroup('manual-one', [b, a]),
      displayedGroup('manual-two', [unsupported, c]),
    ],
  );

  assert.deepEqual(adjacentDisplayedTabTarget(snapshot, a.target, 1, 'group'), b.target);
  assert.deepEqual(adjacentDisplayedTabTarget(snapshot, a.target, 1, 'all'), c.target);
  assert.deepEqual(adjacentDisplayedTabTarget(snapshot, b.target, -1, 'all'), c.target);
  assert.deepEqual(adjacentDisplayedTabTarget(snapshot, unsupported.target, -1, 'all'), a.target);
});

test('moves only the anchor display group selection and keeps pinned partitions fixed', () => {
  const pinnedOne = displayedTab('pinned-one', 0, 0, { isPinned: true });
  const pinnedTwo = displayedTab('pinned-two', 1, 0, { isPinned: true });
  const a = displayedTab('a', 0, 1);
  const b = displayedTab('b', 1, 1);
  const c = displayedTab('c', 0, 2);
  const other = displayedTab('other', 2, 0);
  const snapshot = displayedSnapshot(
    [pinnedOne, a, c, pinnedTwo, b, other],
    [
      displayedGroup('work', [pinnedOne, pinnedTwo, a, b, c]),
      displayedGroup('other', [other]),
    ],
  );
  const selected = [pinnedTwo.target, b.target, other.target];

  assert.deepEqual(
    selectedDisplayedTabsInAnchorGroup(snapshot, b.target, selected).map((tab) => tab.label),
    ['pinned-two', 'b'],
  );
  const plan = planDisplayedTabMove(snapshot, b.target, selected, -1);
  assert.equal(plan?.changed, true);
  assert.deepEqual(plan?.movedTabs.map((tab) => tab.label), ['pinned-two', 'b']);
  assert.deepEqual(plan?.desiredTabs.map((tab) => tab.label), ['pinned-two', 'pinned-one', 'b', 'a', 'c']);
});

test('uses adjacent displayed groups without wrapping and includes empty groups', () => {
  const tab = displayedTab('tab', 0, 0);
  const first = displayedGroup('empty', []);
  const second = displayedGroup('current', [tab]);
  const snapshot = displayedSnapshot([tab], [first, second]);

  assert.equal(adjacentDisplayedGroup(snapshot, tab.target, -1)?.id, 'empty');
  assert.equal(adjacentDisplayedGroup(snapshot, tab.target, 1), undefined);
});

function displayedSnapshot(
  nativeTabs: readonly VerticalTabItem[],
  displayGroups: readonly VerticalTabDisplayGroup[],
): VerticalTabsSnapshot {
  return {
    revision: 1,
    groupMode: 'manual',
    sortMode: 'none',
    toolbarPosition: 'top',
    rememberState: true,
    toolbarControlsVisible: true,
    searchVisible: true,
    searchGroups: false,
    alwaysFollowActiveTab: true,
    nativeContextMenuActionsEnabled: true,
    tabs: nativeTabs,
    manualGroups: [],
    displayGroups,
  };
}

function displayedGroup(id: string, tabs: readonly VerticalTabItem[]): VerticalTabDisplayGroup {
  return {
    id,
    title: id,
    collapsed: false,
    mode: 'manual',
    tabs,
    showHeader: true,
    isManual: true,
    isPinned: false,
  };
}

function displayedTab(
  label: string,
  groupIndex: number,
  tabIndex: number,
  options: { readonly isPinned?: boolean; readonly isActivatable?: boolean } = {},
): VerticalTabItem {
  const target: TabTarget = {
    revision: 1,
    groupIndex,
    tabIndex,
    identity: { kind: 'text', uri: `file:///workspace/${label}.ts` },
  };
  return {
    target,
    label,
    isActive: false,
    isFocused: false,
    isDirty: false,
    isPinned: options.isPinned ?? false,
    isPreview: false,
    activationKind: options.isActivatable === false ? 'unsupported' : 'reliable',
    isActivatable: options.isActivatable ?? true,
    isFile: true,
    inputKind: 'text',
    icon: { kind: 'codicon', name: 'file' },
  };
}
