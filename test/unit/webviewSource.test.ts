import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('context menu close actions dismiss the menu after posting', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /actionButton\('关闭其他标签', '关闭其他标签', 'closeOthers', tab\.target, true\)/);
  assert.match(source, /actionButton\('关闭下侧标签', '关闭下侧标签', 'closeBelow', tab\.target, true\)/);
  assert.match(source, /if \(dismissAfterClick\) dismissContextMenu\(\)/);
});

test('bulk close and create group actions are only exposed from context menus', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(panelSource, /id="add-group"/);
  assert.doesNotMatch(panelSource, /id="close-saved"/);
  assert.doesNotMatch(panelSource, /id="close-all"/);
  assert.match(webviewSource, /verticalTabs\?\.addEventListener\('contextmenu'/);
  assert.match(webviewSource, /function showContextMenu\(x: number, y: number, tab\?: VerticalTabItem\)/);
  assert.match(webviewSource, /if \(tab\) \{\s*menu\.append\(\s*actionButton\('关闭其他标签'/);
  assert.match(webviewSource, /createGroupButton\(\)/);
  assert.match(webviewSource, /globalActionButton\('关闭已保存'/);
  assert.match(webviewSource, /globalActionButton\('关闭全部'/);
});

test('webview exposes grouping, sorting, bulk close, pinning, and drag messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /setGroupMode/);
  assert.match(source, /setSortMode/);
  assert.match(source, /closeAll/);
  assert.match(source, /pinTab/);
  assert.match(source, /unpinTab/);
  assert.match(source, /moveTab/);
  assert.match(source, /createGroupFromTabs/);
});

test('webview retries the initial snapshot request while it is still loading', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /requestInitialSnapshot\('ready'\)/);
  assert.match(source, /requestInitialSnapshot\('requestRefresh'\)/);
  assert.match(source, /refreshAttempts < 5/);
  assert.match(source, /等待标签快照超时/);
  assert.match(source, /2000/);
});

test('webview reports startup, render, and script failures to the extension log', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /logToExtension\('debug', 'Webview 脚本已启动'\)/);
  assert.match(source, /window\.addEventListener\('error'/);
  assert.match(source, /window\.addEventListener\('unhandledrejection'/);
  assert.match(source, /收到标签渲染消息/);
  assert.match(source, /等待标签快照超时/);
});

test('extension snapshot mtime lookup has a timeout', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /INPUT_MTIME_TIMEOUT_MS = 250/);
  assert.match(source, /withTimeout\(vscode\.workspace\.fs\.stat\(uri\), INPUT_MTIME_TIMEOUT_MS\)/);
});

test('extension registers the webview message listener before setting html and keeps an initial host refresh fallback', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /onDidReceiveMessage[\s\S]+this\.configureWebview\(\)/);
  assert.match(source, /INITIAL_HOST_REFRESH_DELAY_MS = 800/);
  assert.match(source, /reason: 'hostInitialFallback', ensureEmptyLayout: false/);
  assert.match(source, /SNAPSHOT_REFRESH_TIMEOUT_MS = 2000/);
  assert.match(source, /刷新垂直标签快照失败，将发送上一份可用快照避免 Webview 停留在加载态/);
  assert.match(source, /private async toSnapshotTabSafe\(tab: vscode\.Tab\): Promise<SnapshotSourceTab>/);
});

test('extension avoids persisting and restoring transient empty-rail widths', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /if \(!this\.hasVisibleUserTabs\(\)\)/);
  assert.match(source, /MAX_EMPTY_RAIL_RESTORE_RATIO = 0\.4/);
  assert.match(source, /getEmptyRailRestoreRatio\(this\.context\)/);
});

test('extension retries undelivered render messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /WEBVIEW_POST_RETRY_DELAY_MS = 250/);
  assert.match(source, /WEBVIEW_POST_MAX_ATTEMPTS = 8/);
  assert.match(source, /private postMessage\(message: ExtensionMessage, attempt = 1\): void/);
  assert.match(source, /private disposed = false/);
  assert.match(source, /this\.disposed = true/);
  assert.match(source, /this\.disposed \|\| VerticalTabsPanel\.panels\.current !== this/);
  assert.match(source, /this\.postMessage\(message, attempt \+ 1\)/);
});

test('extension marks built-in welcome and settings webviews as activatable', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /function getActivatableBuiltInWebviewTarget\(tab: vscode\.Tab\): 'welcome' \| 'settings' \| undefined/);
  assert.match(source, /viewType\.includes\('gettingstarted'\)/);
  assert.match(source, /label\.includes\('入门'\)/);
  assert.match(source, /viewType\.includes\('settings'\)/);
  assert.match(source, /workbench\.action\.openSettings/);
});

test('webview enables best-effort activation with a distinct tooltip', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /activate\.disabled = !tab\.isActivatable/);
  assert.match(source, /function activationTitle\(tab: VerticalTabItem\): string/);
  assert.match(source, /tab\.activationKind === 'bestEffort'/);
  assert.match(source, /使用 VS Code 内置导航命令尝试跳转/);
});

test('webview logs activation clicks with request ids and suppresses drag while pressing activation buttons', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /let activateRequestSequence = 0/);
  assert.match(source, /activate\.addEventListener\('pointerdown'/);
  assert.match(source, /标签激活按钮 pointerdown/);
  assert.match(source, /suspendRowDrag\(row\)/);
  assert.match(source, /activate\.addEventListener\('click'/);
  assert.match(source, /const requestId = nextActivateRequestId\(\)/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'activateTab', target: tab\.target, requestId \}\)/);
  assert.match(source, /function suspendRowDrag\(row: HTMLElement\): void/);
  assert.match(source, /row\.draggable = false/);
  assert.match(source, /row\.draggable = previous/);
  assert.match(source, /标签行开始拖拽/);
  assert.match(source, /kind=\$\{target\.identity\.kind\}/);
});

test('extension selects existing tabs via bounded workbench navigation commands', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /private async selectExistingTab\(tab: vscode\.Tab, requestId\?: string\): Promise<boolean>/);
  assert.match(source, /workbench\.action\.openEditorAtIndex\$\{target\.tabIndex \+ 1\}/);
  assert.match(source, /workbench\.action\.nextEditorInGroup/);
  assert.match(source, /step < target\.group\.tabs\.length/);
  assert.match(source, /function activeTabMatches\(target: TabPosition, tab: vscode\.Tab\): boolean/);
  assert.match(source, /group\.tabs\.indexOf\(activeTab\) === target\.tabIndex/);
  assert.match(source, /sameIdentity\(targetIdentity\(activeTab\), targetIdentity\(tab\)\)/);
});

test('extension logs activation request diagnostics and validates the final active tab', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /收到标签激活请求/);
  assert.match(source, /requestId: message\.requestId/);
  assert.match(source, /targetRevision: message\.target\.revision/);
  assert.match(source, /private async activateTab\(tab: vscode\.Tab, requestId\?: string\): Promise<void>/);
  assert.match(source, /private async selectExistingTab\(tab: vscode\.Tab, requestId\?: string\): Promise<boolean>/);
  assert.match(source, /private logActivationOutcome\(tab: vscode\.Tab, method: string, requestId\?: string\): void/);
  assert.match(source, /标签激活完成并通过校验/);
  assert.match(source, /标签激活后校验失败：当前活动标签与目标不一致/);
  assert.match(source, /function describeActiveTab\(\): Record<string, unknown> \| undefined/);
  assert.match(source, /function describeTabGroups\(\): readonly Record<string, unknown>\[\]/);
});
