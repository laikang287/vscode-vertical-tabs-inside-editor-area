import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, selectCloseTargets, type SnapshotSourceGroup } from '../../src/tabs/TabSnapshot';

const groups: SnapshotSourceGroup[] = [
  {
    isActive: true,
    viewColumn: 1,
    tabs: [
      { label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', isVerticalTabsPanel: true },
      { label: 'index.ts', path: 'src/index.ts', isActive: true, isDirty: true, isPinned: false, isPreview: false, inputKind: 'text' },
      { label: 'index.ts', path: 'test/index.ts', isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text' },
    ],
  },
  {
    isActive: false,
    viewColumn: 2,
    tabs: [
      { label: 'Terminal', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal' },
      { label: 'README.md', path: 'README.md', isActive: false, isDirty: false, isPinned: false, isPreview: true, inputKind: 'text' },
    ],
  },
];

test('builds grouped tab snapshots and removes the extension panel', () => {
  const snapshot = buildSnapshot(groups, 7);
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.groups.length, 2);
  assert.equal(snapshot.groups[0].tabs.length, 2);
  assert.equal(snapshot.groups[0].tabs[0].target.tabIndex, 1);
  assert.equal(snapshot.groups[0].tabs[0].description, 'src/index.ts');
  assert.equal(snapshot.groups[0].tabs[1].description, 'test/index.ts');
  assert.equal(snapshot.groups[1].tabs[0].isActivatable, false);
  assert.equal(snapshot.groups[1].tabs[1].isPreview, true);
});

test('removes the whole rail group even if a foreign tab appears in it', () => {
  const snapshot = buildSnapshot([
    {
      isActive: true,
      viewColumn: 1,
      isVerticalTabsGroup: true,
      tabs: [
        { label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', isVerticalTabsPanel: true },
        { label: 'unexpected.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text' },
      ],
    },
    {
      isActive: false,
      viewColumn: 2,
      tabs: [{ label: 'main.ts', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text' }],
    },
  ], 8);

  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].viewColumn, 2);
  assert.equal(snapshot.groups[0].tabs[0].label, 'main.ts');
});

test('selects the correct close targets and preserves pinned tabs in batches', () => {
  const snapshot = buildSnapshot(groups, 3);
  const active = snapshot.groups[0].tabs[0].target;

  assert.deepEqual(selectCloseTargets(snapshot, 'close', active), [active]);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeOthers', active), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeBelow', active), []);
  assert.deepEqual(selectCloseTargets(snapshot, 'closeSaved'), [snapshot.groups[1].tabs[0].target, snapshot.groups[1].tabs[1].target]);
});
