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
  assert.equal(snapshot.tabs[0].description, 'src/index.ts');
  assert.equal(snapshot.tabs[1].description, 'test/index.ts');
  assert.equal(snapshot.tabs[2].isActivatable, false);
  assert.equal(snapshot.manualGroups[0].name, '工作');
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
  assert.deepEqual(selectCloseTargets(snapshot, 'closeBelow', topLevel), [snapshot.tabs[2].target, snapshot.tabs[3].target]);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeSaved'), [snapshot.tabs[2].target, snapshot.tabs[3].target]);
});
