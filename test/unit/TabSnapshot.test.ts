import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, moveItemsBefore, sameIdentity, selectCloseTargets, selectCloseTargetsForTabs, type SnapshotSourceGroup } from '../../src/tabs/TabSnapshot';

const source: SnapshotSourceGroup[] = [{ tabs: [
  { label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', targetIdentity: { kind: 'webview', viewType: 'verticalTabs.editorArea', label: 'Vertical Tabs' }, isVerticalTabsPanel: true },
  { label: 'index.ts', path: 'src/index.ts', isActive: true, isDirty: true, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/index.ts' }, manualGroupId: 'work' },
  { label: 'index.ts', path: 'test/index.ts', isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/index.ts' } },
] }, { tabs: [
  { label: 'Terminal', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'Terminal' } },
  { label: 'README.md', path: 'README.md', isActive: false, isDirty: false, isPinned: false, isPreview: true, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/README.md' } },
] }];

test('moves single and non-contiguous selected keys to the exact before-target position', () => {
  assert.deepEqual(moveItemsBefore(['a', 'b', 'c', 'd', 'e'], ['a'], 'd'), ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(moveItemsBefore(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 'a'), ['b', 'd', 'a', 'c', 'e']);
  assert.deepEqual(moveItemsBefore(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 'e'), ['a', 'c', 'b', 'd', 'e']);
  assert.deepEqual(moveItemsBefore(['a', 'b', 'c'], ['a', 'c'], undefined), ['b', 'a', 'c']);
});

test('keeps an empty manual root drop target when every tab belongs to a group', () => {
  const groupedSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'a.ts', path: 'src/a.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/a.ts' }, manualGroupId: 'work' },
    { label: 'b.ts', path: 'src/b.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/b.ts' }, manualGroupId: 'work' },
  ] }];

  const snapshot = buildSnapshot(groupedSource, 24, [{ id: 'work', name: 'Work', collapsed: false }], { groupMode: 'manual' });

  assert.equal(snapshot.displayGroups[0]?.id, '__ungrouped');
  assert.equal(snapshot.displayGroups[0]?.showHeader, false);
  assert.deepEqual(snapshot.displayGroups[0]?.tabs, []);
  assert.deepEqual(snapshot.displayGroups[1]?.tabs.map((tab) => tab.label), ['a.ts', 'b.ts']);
});

test('keeps order unchanged when the before-target is part of the moved selection', () => {
  assert.deepEqual(moveItemsBefore(['a', 'b', 'c', 'd'], ['b', 'd'], 'd'), ['a', 'b', 'c', 'd']);
});

test('moves duplicate-looking items by object occurrence instead of collapsing their identities', () => {
  const first = { label: 'same.ts' };
  const second = { label: 'same.ts' };
  const middle = { label: 'middle.ts' };
  assert.deepEqual(moveItemsBefore([first, middle, second], [second], first), [second, first, middle]);
});

test('builds a flat snapshot, hides the extension panel, and retains manual membership', () => {
  const snapshot = buildSnapshot(source, 7, [{ id: 'work', name: '工作', collapsed: false }]);
  assert.equal(snapshot.tabs.length, 4);
  assert.equal(snapshot.tabs[0].target.tabIndex, 1);
  assert.deepEqual(snapshot.tabs[0].target.identity, { kind: 'text', uri: 'file:///workspace/src/index.ts' });
  assert.equal(snapshot.tabs[0].manualGroupId, 'work');
  assert.equal(snapshot.tabs[0].description, undefined);
  assert.equal(snapshot.tabs[1].description, undefined);
  assert.equal(snapshot.tabs[0].activationKind, 'reliable');
  assert.equal(snapshot.tabs[2].activationKind, 'bestEffort');
  assert.equal(snapshot.tabs[2].isActivatable, true);
  assert.equal(snapshot.manualGroups[0].name, '工作');
});

test('distinguishes tabs shown in editor groups from the focused active tab', () => {
  const snapshot = buildSnapshot([{ tabs: [
    { label: 'left.ts', isActive: true, isFocused: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/left.ts' } },
  ] }, { tabs: [
    { label: 'right.ts', isActive: true, isFocused: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/right.ts' } },
  ] }], 23, []);

  assert.deepEqual(snapshot.tabs.map((tab) => tab.isActive), [true, true]);
  assert.deepEqual(snapshot.tabs.map((tab) => tab.isFocused), [true, false]);
});

test('classifies reliable and best-effort activation targets', () => {
  const snapshot = buildSnapshot([{ tabs: [
    { label: 'a.ts', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/a.ts' } },
    { label: 'Settings', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', targetIdentity: { kind: 'webview', viewType: 'settings', label: 'Settings' } },
    { label: 'Terminal', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'Terminal' } },
    { label: 'Unknown', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'unknown', targetIdentity: { kind: 'unknown', label: 'Unknown' } },
  ] }], 14, []);

  assert.deepEqual(snapshot.tabs.map((tab) => tab.activationKind), ['reliable', 'bestEffort', 'bestEffort', 'bestEffort']);
  assert.deepEqual(snapshot.tabs.map((tab) => tab.isActivatable), [true, true, true, true]);
});

test('preserves explicit unsupported activation from the host snapshot', () => {
  const snapshot = buildSnapshot([{ tabs: [
    { label: 'Blocked', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'unknown', isActivatable: false, targetIdentity: { kind: 'unknown', label: 'Blocked' } },
  ] }], 15, []);

  assert.equal(snapshot.tabs[0].activationKind, 'unsupported');
  assert.equal(snapshot.tabs[0].isActivatable, false);
});

test('keeps user tabs next to an extension panel and omits empty extension-only groups', () => {
  const snapshot = buildSnapshot([{ tabs: [{ label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', targetIdentity: { kind: 'webview', viewType: 'verticalTabs.editorArea', label: 'Vertical Tabs' }, isVerticalTabsPanel: true }] }, { tabs: [{ label: 'main.ts', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/main.ts' } }] }], 8, []);
  assert.equal(snapshot.tabs.length, 1);
  assert.equal(snapshot.tabs[0].label, 'main.ts');
  assert.equal(snapshot.displayGroups.length, 1);
  assert.equal(snapshot.displayGroups[0]!.showHeader, false);
  assert.deepEqual(snapshot.displayGroups[0]!.tabs.map((tab) => tab.label), ['main.ts']);
});

test('matches stale snapshot targets by stable identity', () => {
  const previous = buildSnapshot(source, 3, []);
  const current = buildSnapshot([{ tabs: [
    { label: 'README.md', path: 'README.md', isActive: false, isDirty: false, isPinned: false, isPreview: true, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/README.md' } },
    { label: 'index.ts', path: 'test/index.ts', isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/index.ts' } },
    { label: 'Terminal', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'Terminal' } },
  ] }], 4, []);

  assert.equal(sameIdentity(previous.tabs[1].target.identity, current.tabs[1].target.identity), true);
  assert.deepEqual(selectCloseTargets(current, 'closeOthers', previous.tabs[1].target), [current.tabs[0].target, current.tabs[2].target]);
  assert.deepEqual(selectCloseTargets(current, 'closeBelow', previous.tabs[1].target), [current.tabs[0].target, current.tabs[2].target]);
});

test('selects close targets within the same manual display bucket and preserves pinned tabs', () => {
  const snapshot = buildSnapshot(source, 3, [{ id: 'work', name: '工作', collapsed: false }], { groupMode: 'manual' });
  const work = snapshot.tabs[0].target;
  const topLevel = snapshot.tabs[1].target;
  assert.deepEqual(selectCloseTargets(snapshot, 'close', work), [work]);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeOthers', work), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeBelow', topLevel), [snapshot.tabs[2].target, snapshot.tabs[3].target]);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeSaved'), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeAll'), [snapshot.tabs[0].target]);
});


test('scopes closeAll and closeSaved to the focused display group and falls back globally', () => {
  const snapshot = buildSnapshot(source, 5, [{ id: 'work', name: '宸ヤ綔', collapsed: false }], { groupMode: 'manual' });
  // No tab is focused in the source fixture, so the active tab (index.ts src)
  // in the 'work' group drives the scope. The 'work' group has one dirty tab.
  assert.deepEqual(selectCloseTargets(snapshot, 'closeSaved'), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeAll'), [snapshot.tabs[0].target]);

  // Build a snapshot where the README tab is focused (ungrouped bucket).
  const focusedSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', targetIdentity: { kind: 'webview', viewType: 'verticalTabs.editorArea', label: 'Vertical Tabs' }, isVerticalTabsPanel: true },
    { label: 'main.ts', path: 'src/main.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/main.ts' } },
  ] }, { tabs: [
    { label: 'README.md', path: 'README.md', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/README.md' } },
    { label: 'CHANGELOG.md', path: 'CHANGELOG.md', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/CHANGELOG.md' } },
    { label: 'todo.md', path: 'todo.md', isActive: false, isDirty: true, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/todo.md' } },
  ] }];
  const focusedSnapshot = buildSnapshot(focusedSource, 6, [], { groupMode: 'vscode' });
  const readmeTarget = focusedSnapshot.tabs.find((t) => t.label === 'README.md')!.target;
  const changelogTarget = focusedSnapshot.tabs.find((t) => t.label === 'CHANGELOG.md')!.target;
  const todoTarget = focusedSnapshot.tabs.find((t) => t.label === 'todo.md')!.target;
  assert.equal(Boolean(readmeTarget), true);
  // closeSaved: README.md and CHANGELOG.md are not dirty and not pinned in the second group
  assert.deepEqual(selectCloseTargets(focusedSnapshot, 'closeSaved'), [readmeTarget, changelogTarget]);
  // closeAll: all non-pinned tabs in the second group (README.md, CHANGELOG.md, todo.md)
  assert.deepEqual(selectCloseTargets(focusedSnapshot, 'closeAll'), [readmeTarget, changelogTarget, todoTarget]);
});test('applies multi-select close-other and close-below rules independently in every selected group', () => {
  const groups: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'a.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///a.ts' } },
    { label: 'b.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///b.ts' } },
    { label: 'c.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///c.ts' } },
  ] }, { tabs: [
    { label: 'd.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///d.ts' } },
    { label: 'e.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///e.ts' } },
    { label: 'f.ts', isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///f.ts' } },
  ] }];
  const snapshot = buildSnapshot(groups, 20, [], { groupMode: 'vscode' });
  const selected = [snapshot.tabs[1]!.target, snapshot.tabs[3]!.target, snapshot.tabs[4]!.target];

  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'close', selected), selected);
  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'closeOthers', selected), [snapshot.tabs[0]!.target, snapshot.tabs[2]!.target]);
  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'closeBelow', selected), [snapshot.tabs[2]!.target]);
});

test('keeps duplicate resources in different editor groups as separate multi-select occurrences', () => {
  const duplicateGroups: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'same.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///same.ts' } },
    { label: 'left.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///left.ts' } },
  ] }, { tabs: [
    { label: 'same.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///same.ts' } },
    { label: 'right.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///right.ts' } },
  ] }];
  const snapshot = buildSnapshot(duplicateGroups, 23, [], { groupMode: 'vscode' });

  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'close', [snapshot.tabs[2]!.target]), [snapshot.tabs[2]!.target]);
  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'closeOthers', [snapshot.tabs[2]!.target]), [snapshot.tabs[3]!.target]);
});

test('uses VS Code groups and keeps a header for the group close action', () => {
  const snapshot = buildSnapshot(source, 9, [], { groupMode: 'vscode' });
  assert.equal(snapshot.groupMode, 'vscode');
  assert.equal(snapshot.displayGroups.length, 2);
  const singleGroup = buildSnapshot([{ tabs: source[0]!.tabs }], 10, [], { groupMode: 'vscode' });
  assert.equal(singleGroup.displayGroups.length, 1);
  assert.equal(singleGroup.displayGroups[0]!.showHeader, true);
});

test('builds parent directory groups with same-name disambiguation', () => {
  const snapshot = buildSnapshot([{ tabs: [
    { label: 'a.ts', path: 'apps/web/src/a.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/apps/web/src/a.ts' } },
    { label: 'b.ts', path: 'packages/lib/src/b.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/packages/lib/src/b.ts' } },
  ] }], 11, [], { groupMode: 'parentDir' });
  assert.equal(snapshot.displayGroups.length, 2);
  assert.equal(snapshot.displayGroups[0]!.title, 'src');
  assert.equal(snapshot.displayGroups[0]!.description, 'web/src');
  assert.equal(snapshot.displayGroups[1]!.description, 'lib/src');
});

test('builds file type groups and sorts files inside groups only', () => {
  const snapshot = buildSnapshot([{ tabs: [
    { label: 'b.ts', path: 'src/b.ts', mtime: 200, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/b.ts' } },
    { label: 'a.ts', path: 'src/a.ts', mtime: 100, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/a.ts' } },
    { label: 'README', path: 'README', mtime: 50, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/README' } },
  ] }], 12, [], { groupMode: 'fileType', sortMode: 'nameAsc' });
  assert.equal(snapshot.displayGroups[0]!.title, '.ts');
  assert.deepEqual(snapshot.displayGroups[0]!.tabs.map((tab) => tab.label), ['a.ts', 'b.ts']);
  assert.equal(snapshot.displayGroups[1]!.title, 'No extension');
});

test('keeps pinned tabs at the front of each display group for every sort mode', () => {
  const tabs: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'b.ts', path: 'src/b.ts', mtime: 200, isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/b.ts' } },
    { label: 'a.ts', path: 'src/a.ts', mtime: 100, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/a.ts' } },
    { label: 'c.ts', path: 'src/c.ts', mtime: 300, isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/c.ts' } },
    { label: 'd.ts', path: 'src/d.ts', mtime: 400, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/d.ts' } },
  ] }];

  const unsorted = buildSnapshot(tabs, 17, [], { groupMode: 'vscode', sortMode: 'none' });
  assert.deepEqual(unsorted.displayGroups[0]!.tabs.map((tab) => tab.label), ['b.ts', 'c.ts', 'a.ts', 'd.ts']);

  const byName = buildSnapshot(tabs, 18, [], { groupMode: 'vscode', sortMode: 'nameDesc' });
  assert.deepEqual(byName.displayGroups[0]!.tabs.map((tab) => tab.label), ['c.ts', 'b.ts', 'd.ts', 'a.ts']);

  const byModified = buildSnapshot(tabs, 19, [], { groupMode: 'vscode', sortMode: 'modifiedAsc' });
  assert.deepEqual(byModified.displayGroups[0]!.tabs.map((tab) => tab.label), ['b.ts', 'c.ts', 'a.ts', 'd.ts']);
});

test('orders pinned manual and automatic groups first while retaining their relative order', () => {
  const grouped: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'a.ts', path: 'alpha/a.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///alpha/a.ts' }, manualGroupId: 'alpha' },
    { label: 'b.ts', path: 'beta/b.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///beta/b.ts' }, manualGroupId: 'beta' },
  ] }];
  const pinned = new Set(['beta']);
  const manual = buildSnapshot(grouped, 21, [
    { id: 'alpha', name: 'Alpha', collapsed: false },
    { id: 'beta', name: 'Beta', collapsed: false },
  ], { groupMode: 'manual', pinnedGroupIds: pinned });
  assert.deepEqual(manual.displayGroups.filter((group) => group.showHeader).map((group) => [group.id, group.isPinned]), [['beta', true], ['alpha', false]]);

  const automatic = buildSnapshot(grouped, 22, [], { groupMode: 'parentDir', pinnedGroupIds: new Set(['beta']) });
  assert.deepEqual(automatic.displayGroups.map((group) => [group.id, group.isPinned]), [['beta', true], ['alpha', false]]);
});

test('orders manual tabs from persisted identity order', () => {
  const manualSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'index.ts', path: 'src/index.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/index.ts' }, manualGroupId: 'work' },
    { label: 'index.ts', path: 'test/index.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/index.ts' }, manualGroupId: 'work' },
  ] }];
  const order = new Map<string, string[]>([['work', [
    JSON.stringify({ kind: 'text', uri: 'file:///workspace/test/index.ts' }),
    JSON.stringify({ kind: 'text', uri: 'file:///workspace/src/index.ts' }),
  ]]]);
  const snapshot = buildSnapshot(manualSource, 13, [{ id: 'work', name: '工作', collapsed: false }], { groupMode: 'manual', manualOrderByGroup: order });
  const workGroup = snapshot.displayGroups.find((group) => group.id === 'work');
  assert.deepEqual(workGroup?.tabs.map((tab) => tab.description), [undefined, undefined]);
});

test('renders manual ungrouped tabs at the tree root without an ungrouped header', () => {
  const snapshot = buildSnapshot(source, 16, [{ id: 'work', name: '工作', collapsed: false }], { groupMode: 'manual' });
  const ungrouped = snapshot.displayGroups.find((group) => group.id === '__ungrouped');
  const workGroup = snapshot.displayGroups.find((group) => group.id === 'work');

  assert.equal(ungrouped?.title, 'Ungrouped');
  assert.equal(ungrouped?.showHeader, false);
  assert.deepEqual(ungrouped?.tabs.map((tab) => tab.label), ['index.ts', 'Terminal', 'README.md']);
  assert.equal(workGroup?.showHeader, true);
  assert.deepEqual(workGroup?.tabs.map((tab) => tab.label), ['index.ts']);
});

test('places newly opened manual-order root tabs after root files and before manual groups', () => {
  const manualSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: '标签1', path: 'one.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/one.ts' } },
    { label: '标签2', path: 'two.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/two.ts' } },
    { label: '标签3', path: 'three.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/three.ts' } },
    { label: '分组1文件', path: 'group-one.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/group-one.ts' }, manualGroupId: 'group-1' },
    { label: '分组2文件', path: 'group-two.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/group-two.ts' }, manualGroupId: 'group-2' },
    { label: '新标签', path: 'new.ts', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/new.ts' } },
  ] }];
  const order = new Map<string, string[]>([['__ungrouped', [
    JSON.stringify({ kind: 'text', uri: 'file:///workspace/one.ts' }),
    JSON.stringify({ kind: 'text', uri: 'file:///workspace/two.ts' }),
    JSON.stringify({ kind: 'text', uri: 'file:///workspace/three.ts' }),
    JSON.stringify({ kind: 'text', uri: 'file:///workspace/new.ts' }),
  ]]]);

  const snapshot = buildSnapshot(manualSource, 25, [
    { id: 'group-1', name: '分组1', collapsed: false },
    { id: 'group-2', name: '分组2', collapsed: false },
  ], { groupMode: 'manual', sortMode: 'none', manualOrderByGroup: order });

  assert.deepEqual(snapshot.displayGroups.map((group) => group.id), ['__ungrouped', 'group-1', 'group-2']);
  assert.deepEqual(snapshot.displayGroups[0]?.tabs.map((tab) => tab.label), ['标签1', '标签2', '标签3', '新标签']);
  assert.deepEqual(snapshot.displayGroups.slice(1).map((group) => group.title), ['分组1', '分组2']);
});
