import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, sameIdentity, selectCloseTargets, type SnapshotSourceGroup } from '../../src/tabs/TabSnapshot';

const source: SnapshotSourceGroup[] = [{ tabs: [
  { label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', targetIdentity: { kind: 'webview', viewType: 'verticalTabs.editorArea', label: 'Vertical Tabs' }, isVerticalTabsPanel: true },
  { label: 'index.ts', path: 'src/index.ts', isActive: true, isDirty: true, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/index.ts' }, manualGroupId: 'work' },
  { label: 'index.ts', path: 'test/index.ts', isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/index.ts' } },
] }, { tabs: [
  { label: 'Terminal', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'Terminal' } },
  { label: 'README.md', path: 'README.md', isActive: false, isDirty: false, isPinned: false, isPreview: true, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/README.md' } },
] }];

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
  assert.deepEqual(selectCloseTargets(current, 'closeBelow', previous.tabs[1].target), [current.tabs[2].target]);
});

test('selects close targets within the same manual display bucket and preserves pinned tabs', () => {
  const snapshot = buildSnapshot(source, 3, [{ id: 'work', name: '工作', collapsed: false }]);
  const work = snapshot.tabs[0].target;
  const topLevel = snapshot.tabs[1].target;
  assert.deepEqual(selectCloseTargets(snapshot, 'close', work), [work]);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeOthers', work), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeBelow', topLevel), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeSaved'), [snapshot.tabs[2].target, snapshot.tabs[3].target]);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeAll'), [snapshot.tabs[0].target, snapshot.tabs[2].target, snapshot.tabs[3].target]);
});

test('uses VS Code groups and hides the only display group header', () => {
  const snapshot = buildSnapshot(source, 9, [], { groupMode: 'vscode' });
  assert.equal(snapshot.groupMode, 'vscode');
  assert.equal(snapshot.displayGroups.length, 2);
  const singleGroup = buildSnapshot([{ tabs: source[0]!.tabs }], 10, [], { groupMode: 'vscode' });
  assert.equal(singleGroup.displayGroups.length, 1);
  assert.equal(singleGroup.displayGroups[0]!.showHeader, false);
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
  assert.equal(snapshot.displayGroups[1]!.title, '无扩展名');
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
