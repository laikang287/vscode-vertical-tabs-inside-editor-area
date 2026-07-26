import assert from 'node:assert/strict';
import test from 'node:test';
import { SingletonPanel } from '../../src/webview/SingletonPanel';
import { parseWebviewMessage } from '../../src/webview/messages';

const target = { revision: 4, groupIndex: 1, tabIndex: 2, identity: { kind: 'text', uri: 'file:///workspace/index.ts' } } as const;

test('accepts ready messages', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(
    parseWebviewMessage({ type: 'ready', collapsedGroupKeys: ['manual:one:closed'] }),
    { type: 'ready', collapsedGroupKeys: ['manual:one:closed'] },
  );
});

test('accepts refresh requests', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'requestRefresh' }), { type: 'requestRefresh' });
  assert.deepEqual(parseWebviewMessage({ type: 'manageWorksets' }), { type: 'manageWorksets' });
  assert.deepEqual(
    parseWebviewMessage({ type: 'setCollapsedGroups', keys: ['vscode:vscode-0:closed'] }),
    { type: 'setCollapsedGroups', keys: ['vscode:vscode-0:closed'] },
  );
});

test('accepts render acknowledgement messages', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'renderAck', revision: 7 }), { type: 'renderAck', revision: 7 });
});

test('accepts bounded webview log messages', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'webviewLog', level: 'debug', message: 'started' }), { type: 'webviewLog', level: 'debug', message: 'started' });
  assert.deepEqual(parseWebviewMessage({ type: 'webviewLog', level: 'error', message: 'failed', details: 'stack' }), { type: 'webviewLog', level: 'error', message: 'failed', details: 'stack' });
});

test('accepts tab actions with a valid snapshot target', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'activateTab', target }), { type: 'activateTab', target });
  assert.deepEqual(parseWebviewMessage({ type: 'activateTab', target, requestId: 'activate-1' }), { type: 'activateTab', target, requestId: 'activate-1' });
  assert.deepEqual(parseWebviewMessage({ type: 'closeBelow', target }), { type: 'closeBelow', target });
  assert.deepEqual(parseWebviewMessage({ type: 'closeSaved' }), { type: 'closeSaved' });
  assert.deepEqual(parseWebviewMessage({ type: 'railWidth', width: 280 }), { type: 'railWidth', width: 280 });
  assert.deepEqual(parseWebviewMessage({ type: 'requestCreateGroup' }), { type: 'requestCreateGroup' });
  assert.deepEqual(parseWebviewMessage({ type: 'createGroup', name: '工作' }), { type: 'createGroup', name: '工作' });
  assert.deepEqual(parseWebviewMessage({ type: 'renameGroup', groupId: 'work_1', name: '新名称' }), { type: 'renameGroup', groupId: 'work_1', name: '新名称' });
  assert.deepEqual(parseWebviewMessage({ type: 'assignGroup', target, groupId: 'work_1' }), { type: 'assignGroup', target, groupId: 'work_1' });
  assert.deepEqual(parseWebviewMessage({ type: 'assignGroup', target }), { type: 'assignGroup', target });
  assert.deepEqual(parseWebviewMessage({ type: 'closeAll' }), { type: 'closeAll' });
  assert.deepEqual(parseWebviewMessage({ type: 'setGroupMode', groupMode: 'parentDir' }), { type: 'setGroupMode', groupMode: 'parentDir' });
  assert.deepEqual(parseWebviewMessage({ type: 'setSortMode', sortMode: 'mru' }), { type: 'setSortMode', sortMode: 'mru' });
  assert.deepEqual(parseWebviewMessage({ type: 'setSortMode', sortMode: 'nameDesc' }), { type: 'setSortMode', sortMode: 'nameDesc' });
  assert.deepEqual(parseWebviewMessage({ type: 'setToolbarControlsVisible', visible: false }), { type: 'setToolbarControlsVisible', visible: false });
  assert.deepEqual(parseWebviewMessage({ type: 'pinTab', target }), { type: 'pinTab', target });
  assert.deepEqual(parseWebviewMessage({ type: 'unpinTab', target }), { type: 'unpinTab', target });
  assert.deepEqual(parseWebviewMessage({ type: 'moveTab', target, groupId: 'work_1', beforeTarget: target }), { type: 'moveTab', target, groupId: 'work_1', beforeTarget: target });
  assert.deepEqual(parseWebviewMessage({ type: 'moveTab', target, groupId: 'apps/web/src' }), { type: 'moveTab', target, groupId: 'apps/web/src' });
  assert.deepEqual(parseWebviewMessage({ type: 'moveTabs', targets: [target], groupId: 'vscode-1', beforeTarget: target }), { type: 'moveTabs', targets: [target], groupId: 'vscode-1', beforeTarget: target });
  assert.deepEqual(parseWebviewMessage({ type: 'selectionChanged', targets: [target] }), { type: 'selectionChanged', targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'selectionChanged', targets: [] }), { type: 'selectionChanged', targets: [] });
  assert.deepEqual(parseWebviewMessage({ type: 'closeTabs', targets: [target] }), { type: 'closeTabs', targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'closeOthersForTabs', targets: [target] }), { type: 'closeOthersForTabs', targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'closeBelowForTabs', targets: [target] }), { type: 'closeBelowForTabs', targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'pinTabs', targets: [target] }), { type: 'pinTabs', targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'unpinTabs', targets: [target] }), { type: 'unpinTabs', targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'closeGroup', groupId: 'work_1' }), { type: 'closeGroup', groupId: 'work_1' });
  assert.deepEqual(parseWebviewMessage({ type: 'pinGroup', groupId: 'work_1' }), { type: 'pinGroup', groupId: 'work_1' });
  assert.deepEqual(parseWebviewMessage({ type: 'closeGroup', groupId: 'apps/web/src' }), { type: 'closeGroup', groupId: 'apps/web/src' });
  assert.deepEqual(parseWebviewMessage({ type: 'pinGroup', groupId: '.ts' }), { type: 'pinGroup', groupId: '.ts' });
  assert.deepEqual(parseWebviewMessage({ type: 'reorderManualTab', target }), { type: 'reorderManualTab', target });
  assert.deepEqual(parseWebviewMessage({ type: 'createGroupFromTabs', source: target, target }), { type: 'createGroupFromTabs', source: target, target });
  assert.deepEqual(parseWebviewMessage({ type: 'moveToPreviousGroup', target }), { type: 'moveToPreviousGroup', target });
  assert.deepEqual(parseWebviewMessage({ type: 'moveToGroup', target, groupIndex: 2 }), { type: 'moveToGroup', target, groupIndex: 2 });
  assert.deepEqual(parseWebviewMessage({ type: 'requestNativeTabMenu', requestId: 'native-menu-1', target, targets: [target] }), { type: 'requestNativeTabMenu', requestId: 'native-menu-1', target, targets: [target] });
  assert.deepEqual(parseWebviewMessage({ type: 'runNativeTabMenuAction', actionId: 'opaque_1_2', target, targets: [target] }), { type: 'runNativeTabMenuAction', actionId: 'opaque_1_2', target, targets: [target] });
});

test('rejects malformed and unknown messages', () => {
  for (const value of [
    undefined,
    null,
    [],
    'ready',
    {},
    { type: 'unknown' },
    { type: 42 },
    { type: 'webviewLog', level: 'info', message: 'bad' },
    { type: 'webviewLog', level: 'debug', message: '' },
    { type: 'webviewLog', level: 'debug', message: 'x', details: 42 },
    { type: 'renderAck', revision: -1 },
    { type: 'renderAck', revision: 1.5 },
    { type: 'renderAck', revision: '7' },
    { type: 'activateTab' },
    { type: 'activateTab', target, requestId: '' },
    { type: 'activateTab', target, requestId: 42 },
    { type: 'activateTab', target, requestId: 'x'.repeat(81) },
    { type: 'activateTab', target: { revision: -1, groupIndex: 0, tabIndex: 0 } },
    { type: 'activateTab', target: { revision: 1.5, groupIndex: 0, tabIndex: 0 } },
    { type: 'activateTab', target: { revision: 1, groupIndex: 0, tabIndex: 0 } },
    { type: 'activateTab', target: { revision: 1, groupIndex: 0, tabIndex: 0, identity: { kind: 'text', uri: '' } } },
    { type: 'railWidth', width: 179 },
    { type: 'railWidth', width: 280.5 },
    { type: 'railWidth', width: '280' },
    { type: 'createGroup', name: '' },
    { type: 'deleteGroup', groupId: '../bad' },
    { type: 'closeGroup', groupId: 'bad\nvalue' },
    { type: 'assignGroup', target: { revision: 1, groupIndex: 0, tabIndex: 0 }, groupId: 42 },
    { type: 'setGroupMode', groupMode: 'bad' },
    { type: 'setSortMode', sortMode: 'bad' },
    { type: 'setToolbarControlsVisible', visible: 'false' },
    { type: 'moveTab', target, groupId: '../bad' },
    { type: 'moveTab', target, groupId: 'bad\nvalue' },
    { type: 'moveTab', target, beforeTarget: { revision: 1, groupIndex: 0, tabIndex: 0 } },
    { type: 'createGroupFromTabs', source: target },
    { type: 'moveToGroup', target, groupIndex: -1 },
    { type: 'moveToGroup', target, groupIndex: 1.5 },
    { type: 'requestNativeTabMenu', requestId: '', target, targets: [target] },
    { type: 'requestNativeTabMenu', requestId: 'x'.repeat(81), target, targets: [target] },
    { type: 'requestNativeTabMenu', requestId: 'native-menu-1', target, targets: [] },
    { type: 'runNativeTabMenuAction', actionId: 'workbench.action.closeActiveEditor', target, targets: [target] },
    { type: 'runNativeTabMenuAction', actionId: 'bad value', target, targets: [target] },
    { type: 'runNativeTabMenuAction', actionId: 'opaque_1_2', target, targets: [] },
  ]) {
    assert.equal(parseWebviewMessage(value), undefined);
  }
});

test('creates once, reveals the existing panel, and clears on disposal', () => {
  const panels = new SingletonPanel<{ readonly id: number }>();
  const created = { id: 1 };
  const revealed: number[] = [];

  assert.equal(panels.show(() => created, (panel) => revealed.push(panel.id)), created);
  assert.equal(panels.show(() => ({ id: 2 }), (panel) => revealed.push(panel.id)), created);
  assert.deepEqual(revealed, [1]);

  panels.clear(created);
  assert.equal(panels.current, undefined);
});
