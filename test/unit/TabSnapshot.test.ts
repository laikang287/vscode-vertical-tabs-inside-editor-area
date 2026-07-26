import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSnapshot, displayOrderKey, moveItemsBefore, sameIdentity, selectCloseTargets, selectCloseTargetsForTabs, type SnapshotSourceGroup } from '../../src/tabs/TabSnapshot';

const source: SnapshotSourceGroup[] = [{ tabs: [
  { label: 'Vertical Tabs', isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'webview', targetIdentity: { kind: 'webview', viewType: 'verticalTabs.editorArea', label: 'Vertical Tabs' }, isVerticalTabsPanel: true },
  { label: 'index.ts', path: 'src/index.ts', directoryName: 'src', relativePath: 'src/index.ts', resourceStatus: 'readonly', isActive: true, isDirty: true, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/index.ts' }, manualGroupId: 'work' },
  { label: 'index.ts', path: 'test/index.ts', directoryName: 'test', relativePath: 'test/index.ts', isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/index.ts' } },
] }, { tabs: [
  { label: 'Terminal', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'Terminal' } },
  { label: 'README.md', path: 'README.md', directoryName: 'workspace', relativePath: 'README.md', isActive: false, isDirty: false, isPinned: false, isPreview: true, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/README.md' } },
] }];

test('defaults presentation settings and preserves explicit overrides', () => {
  assert.equal(buildSnapshot(source, 1, []).toolbarPosition, 'top');
  assert.equal(buildSnapshot(source, 1, []).alwaysFollowActiveTab, true);
  assert.equal(buildSnapshot(source, 1, []).nativeContextMenuActionsEnabled, true);
  assert.equal(buildSnapshot(source, 1, []).compactContextSubmenusEnabled, true);
  assert.equal(buildSnapshot(source, 2, [], { toolbarPosition: 'bottom' }).toolbarPosition, 'bottom');
  assert.equal(buildSnapshot(source, 2, [], { alwaysFollowActiveTab: false }).alwaysFollowActiveTab, false);
  assert.equal(buildSnapshot(source, 2, [], { nativeContextMenuActionsEnabled: false }).nativeContextMenuActionsEnabled, false);
  assert.equal(buildSnapshot(source, 2, [], { compactContextSubmenusEnabled: false }).compactContextSubmenusEnabled, false);
});

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
  assert.equal(snapshot.tabs[0].isDirty, true);
  assert.equal(snapshot.tabs[1].isDirty, false);
  assert.equal(snapshot.tabs[0].inputKind, 'text');
  assert.equal(snapshot.tabs[0].resourceStatus, 'readonly');
  assert.equal(snapshot.tabs[0].description, undefined);
  assert.equal(snapshot.tabs[1].description, undefined);
  assert.equal(snapshot.tabs[0].workspaceRelativePath, 'src/index.ts');
  assert.equal(snapshot.tabs[1].workspaceRelativePath, 'test/index.ts');
  assert.equal(snapshot.tabs[0].activationKind, 'reliable');
  assert.equal(snapshot.tabs[2].activationKind, 'bestEffort');
  assert.equal(snapshot.tabs[2].isActivatable, true);
  assert.equal(snapshot.manualGroups[0].name, '工作');
});

test('shows directory names or workspace-relative paths according to all five display modes', () => {
  const duplicateDirectories = buildSnapshot(source, 8, [], { relativePathDisplay: 'duplicatesDirectory' });
  assert.deepEqual(duplicateDirectories.tabs.map((tab) => tab.description), [
    'src',
    'test',
    undefined,
    undefined,
  ]);

  const duplicatePaths = buildSnapshot(source, 8, [], { relativePathDisplay: 'duplicates' });
  assert.deepEqual(duplicatePaths.tabs.map((tab) => tab.description), [
    'src/index.ts',
    'test/index.ts',
    undefined,
    undefined,
  ]);

  const allDirectories = buildSnapshot(source, 9, [], { relativePathDisplay: 'alwaysDirectory' });
  assert.deepEqual(allDirectories.tabs.map((tab) => tab.description), [
    'src',
    'test',
    undefined,
    'workspace',
  ]);

  const allPaths = buildSnapshot(source, 9, [], { relativePathDisplay: 'always' });
  assert.deepEqual(allPaths.tabs.map((tab) => tab.description), [
    'src/index.ts',
    'test/index.ts',
    undefined,
    'README.md',
  ]);

  const hiddenPaths = buildSnapshot(source, 10, [], { relativePathDisplay: 'off' });
  assert.ok(hiddenPaths.tabs.every((tab) => tab.description === undefined));
});

test('directory modes support files outside the workspace while relative-path modes remain workspace-only', () => {
  const outsideSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'outside.ts', path: '/tmp/outside.ts', directoryName: 'tmp', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///tmp/outside.ts' } },
  ] }];

  assert.equal(buildSnapshot(outsideSource, 25, [], { relativePathDisplay: 'alwaysDirectory' }).tabs[0]?.description, 'tmp');
  assert.equal(buildSnapshot(outsideSource, 26, [], { relativePathDisplay: 'always' }).tabs[0]?.description, undefined);
  assert.equal(buildSnapshot(outsideSource, 27, []).tabs[0]?.workspaceRelativePath, undefined);
});

test('non-file tabs do not make a file name count as duplicated', () => {
  const mixedSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'shared', directoryName: 'src', relativePath: 'src/shared', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/shared' } },
    { label: 'shared', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'shared' } },
  ] }];

  const snapshot = buildSnapshot(mixedSource, 27, [], { relativePathDisplay: 'duplicatesDirectory' });
  assert.deepEqual(snapshot.tabs.map((tab) => tab.description), [undefined, undefined]);
});

test('detects duplicate tab names without case differences', () => {
  const caseVariantSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'Index.ts', directoryName: 'src', relativePath: 'src/Index.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/Index.ts' } },
    { label: 'index.ts', directoryName: 'test', relativePath: 'test/index.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/index.ts' } },
  ] }];

  const snapshot = buildSnapshot(caseVariantSource, 11, [], { relativePathDisplay: 'duplicates' });
  assert.deepEqual(snapshot.tabs.map((tab) => tab.description), ['src/Index.ts', 'test/index.ts']);
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
  assert.deepEqual(selectCloseTargets(snapshot, 'close', topLevel), [topLevel]);
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
  const selected = [snapshot.tabs[1]!.target, snapshot.tabs[3]!.target, snapshot.tabs[4]!.target, snapshot.tabs[5]!.target];

  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'close', selected), selected.slice(0, -1));
  assert.deepEqual(selectCloseTargetsForTabs(snapshot, 'close', [snapshot.tabs[5]!.target]), []);
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

test('builds a depth-first parent directory tree from open tabs only', () => {
  const snapshot = buildSnapshot([{ tabs: [
    {
      label: 'a.ts',
      path: 'src/features/a.ts',
      isActive: true,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///workspace/src/features/a.ts' },
      directoryTree: [
        { uri: 'file:///workspace', name: 'workspace' },
        { uri: 'file:///workspace/src', name: 'src' },
        { uri: 'file:///workspace/src/features', name: 'features' },
      ],
    },
    {
      label: 'README.md',
      path: 'README.md',
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///workspace/README.md' },
      directoryTree: [{ uri: 'file:///workspace', name: 'workspace' }],
    },
  ] }], 30, [], { groupMode: 'parentDirTree' });

  assert.deepEqual(snapshot.displayGroups.map((group) => [group.title, group.depth, group.parentId !== undefined, group.tabs.map((tab) => tab.label)]), [
    ['workspace', 1, false, ['README.md']],
    ['src', 2, true, []],
    ['features', 3, true, ['a.ts']],
  ]);
  assert.ok(snapshot.displayGroups.every((group) => group.id.startsWith('dir-tree-')));
});

test('builds separate roots for multiple workspaces, outside resources, and non-file tabs', () => {
  const snapshot = buildSnapshot([{ tabs: [
    {
      label: 'README.md',
      path: 'README.md',
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///workspace-a/README.md' },
      directoryTree: [{ uri: 'file:///workspace-a', name: 'workspace-a' }],
    },
    {
      label: 'index.ts',
      path: 'src/index.ts',
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///workspace-b/src/index.ts' },
      directoryTree: [
        { uri: 'file:///workspace-b', name: 'workspace-b' },
        { uri: 'file:///workspace-b/src', name: 'src' },
      ],
    },
    {
      label: 'outside.ts',
      path: '/tmp/outside.ts',
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///tmp/outside.ts' },
      directoryTree: [{ uri: 'file:///tmp', name: 'tmp' }],
      isOutsideWorkspace: true,
    },
    {
      label: 'Terminal',
      isActive: true,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'terminal',
      targetIdentity: { kind: 'terminal', label: 'Terminal' },
    },
  ] }], 34, [], { groupMode: 'parentDirTree' });

  assert.deepEqual(
    snapshot.displayGroups.filter((group) => group.parentId === undefined).map((group) => group.title),
    ['workspace-a', 'workspace-b', 'Outside workspace', 'Other'],
  );
  assert.deepEqual(snapshot.displayGroups.find((group) => group.title === 'workspace-a')?.tabs.map((tab) => tab.label), ['README.md']);
  assert.equal(snapshot.displayGroups.find((group) => group.title === 'src')?.depth, 2);
  assert.equal(snapshot.displayGroups.find((group) => group.title === 'tmp')?.parentId, '__outside-workspace');
  assert.equal(snapshot.displayGroups.find((group) => group.title === 'Other')?.tabs[0]?.label, 'Terminal');
});

test('renders nested manual groups depth-first and keeps direct memberships', () => {
  const nested = buildSnapshot(source, 31, [
    { id: 'work', name: 'Work', collapsed: false },
    { id: 'feature', name: 'Feature', collapsed: false, parentId: 'work' },
  ], { groupMode: 'manual' });

  assert.deepEqual(nested.displayGroups.map((group) => [group.id, group.parentId, group.depth]), [
    ['__ungrouped', undefined, 0],
    ['work', undefined, 1],
    ['feature', 'work', 2],
  ]);
  assert.deepEqual(nested.displayGroups.find((group) => group.id === 'work')?.tabs.map((tab) => tab.label), ['index.ts']);
});

test('sorts manual siblings by the newest tab anywhere in each subtree', () => {
  const grouped: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'older.ts', path: 'older/older.ts', mtime: 100, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/older/older.ts' }, manualGroupId: 'older-child' },
    { label: 'newer.ts', path: 'newer/newer.ts', mtime: 900, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/newer/newer.ts' }, manualGroupId: 'newer-child' },
  ] }];
  const snapshot = buildSnapshot(grouped, 32, [
    { id: 'older-root', name: 'Older', collapsed: false },
    { id: 'older-child', name: 'Older child', collapsed: false, parentId: 'older-root' },
    { id: 'newer-root', name: 'Newer', collapsed: false },
    { id: 'newer-child', name: 'Newer child', collapsed: false, parentId: 'newer-root' },
  ], { groupMode: 'manual', sortMode: 'modifiedDesc' });

  assert.deepEqual(
    snapshot.displayGroups.filter((group) => group.depth === 1).map((group) => group.id),
    ['newer-root', 'older-root'],
  );
});

test('sorts directory siblings by descendant modification time', () => {
  const snapshot = buildSnapshot([{ tabs: [
    {
      label: 'older.ts',
      path: 'older/child/older.ts',
      mtime: 100,
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///workspace/older/child/older.ts' },
      directoryTree: [
        { uri: 'file:///workspace', name: 'workspace' },
        { uri: 'file:///workspace/older', name: 'older' },
        { uri: 'file:///workspace/older/child', name: 'child' },
      ],
    },
    {
      label: 'newer.ts',
      path: 'newer/child/newer.ts',
      mtime: 900,
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview: false,
      inputKind: 'text',
      targetIdentity: { kind: 'text', uri: 'file:///workspace/newer/child/newer.ts' },
      directoryTree: [
        { uri: 'file:///workspace', name: 'workspace' },
        { uri: 'file:///workspace/newer', name: 'newer' },
        { uri: 'file:///workspace/newer/child', name: 'child' },
      ],
    },
  ] }], 33, [], { groupMode: 'parentDirTree', sortMode: 'modifiedDesc' });
  const root = snapshot.displayGroups[0]!;
  assert.deepEqual(
    snapshot.displayGroups.filter((group) => group.parentId === root.id).map((group) => group.title),
    ['newer', 'older'],
  );
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

test('sorts all tab kinds by global MRU time and keeps never-activated tabs in native order', () => {
  const groups: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'never-left.ts', path: 'src/never-left.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/never-left.ts' } },
    { label: 'older.ts', path: 'src/older.ts', lastActivatedAt: 100, isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/older.ts' } },
    { label: 'Terminal', lastActivatedAt: 300, isActive: true, isFocused: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'terminal', targetIdentity: { kind: 'terminal', label: 'Terminal' } },
  ] }, { tabs: [
    { label: 'never-right.ts', path: 'test/never-right.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/never-right.ts' } },
    { label: 'newer.ts', path: 'test/newer.ts', lastActivatedAt: 200, isActive: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/test/newer.ts' } },
  ] }];

  const snapshot = buildSnapshot(groups, 26, [], { groupMode: 'manual', sortMode: 'mru' });

  assert.deepEqual(
    snapshot.displayGroups[0]!.tabs.map((tab) => tab.label),
    ['Terminal', 'newer.ts', 'older.ts', 'never-left.ts', 'never-right.ts'],
  );
  assert.equal(snapshot.tabs.find((tab) => tab.label === 'Terminal')?.lastActivatedAt, 300);
});

test('keeps pinned tabs ahead of more recently used unpinned tabs in MRU mode', () => {
  const groups: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'recent.ts', path: 'src/recent.ts', lastActivatedAt: 500, isActive: true, isFocused: true, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/recent.ts' } },
    { label: 'pinned.ts', path: 'src/pinned.ts', lastActivatedAt: 100, isActive: false, isDirty: false, isPinned: true, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/pinned.ts' } },
  ] }];

  const snapshot = buildSnapshot(groups, 27, [], { groupMode: 'vscode', sortMode: 'mru' });

  assert.deepEqual(snapshot.displayGroups[0]!.tabs.map((tab) => tab.label), ['pinned.ts', 'recent.ts']);
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
  const snapshot = buildSnapshot(manualSource, 13, [{ id: 'work', name: '工作', collapsed: false }], { groupMode: 'manual', displayOrderByGroup: order });
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
  ], { groupMode: 'manual', sortMode: 'none', displayOrderByGroup: order });

  assert.deepEqual(snapshot.displayGroups.map((group) => group.id), ['__ungrouped', 'group-1', 'group-2']);
  assert.deepEqual(snapshot.displayGroups[0]?.tabs.map((tab) => tab.label), ['标签1', '标签2', '标签3', '新标签']);
  assert.deepEqual(snapshot.displayGroups.slice(1).map((group) => group.title), ['分组1', '分组2']);
});

test('applies independent persisted vertical order to automatic groups in manual sorting mode', () => {
  const automaticSource: SnapshotSourceGroup[] = [{ tabs: [
    { label: 'b.ts', path: 'src/b.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/b.ts' } },
    { label: 'a.ts', path: 'src/a.ts', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/src/a.ts' } },
    { label: 'z.md', path: 'docs/z.md', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/docs/z.md' } },
    { label: 'y.md', path: 'docs/y.md', isActive: false, isDirty: false, isPinned: false, isPreview: false, inputKind: 'text', targetIdentity: { kind: 'text', uri: 'file:///workspace/docs/y.md' } },
  ] }];
  const order = new Map<string, string[]>([
    [displayOrderKey('parentDir', 'src'), [
      JSON.stringify({ kind: 'text', uri: 'file:///workspace/src/a.ts' }),
      JSON.stringify({ kind: 'text', uri: 'file:///workspace/src/b.ts' }),
    ]],
    [displayOrderKey('fileType', '.md'), [
      JSON.stringify({ kind: 'text', uri: 'file:///workspace/docs/y.md' }),
      JSON.stringify({ kind: 'text', uri: 'file:///workspace/docs/z.md' }),
    ]],
  ]);

  const byParent = buildSnapshot(automaticSource, 31, [], {
    groupMode: 'parentDir',
    sortMode: 'none',
    displayOrderByGroup: order,
  });
  const byType = buildSnapshot(automaticSource, 32, [], {
    groupMode: 'fileType',
    sortMode: 'none',
    displayOrderByGroup: order,
  });

  assert.deepEqual(byParent.displayGroups.find((group) => group.id === 'src')?.tabs.map((tab) => tab.label), ['a.ts', 'b.ts']);
  assert.deepEqual(byType.displayGroups.find((group) => group.id === '.md')?.tabs.map((tab) => tab.label), ['y.md', 'z.md']);
});
