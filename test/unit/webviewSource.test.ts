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
});

test('extension avoids persisting and restoring transient empty-rail widths', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /if \(!this\.hasVisibleUserTabs\(\)\)/);
  assert.match(source, /MAX_EMPTY_RAIL_RESTORE_RATIO = 0\.4/);
  assert.match(source, /getEmptyRailRestoreRatio\(this\.context\)/);
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

test('extension selects existing tabs via bounded workbench navigation commands', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /private async selectExistingTab\(tab: vscode\.Tab\): Promise<boolean>/);
  assert.match(source, /workbench\.action\.openEditorAtIndex\$\{target\.tabIndex \+ 1\}/);
  assert.match(source, /workbench\.action\.nextEditorInGroup/);
  assert.match(source, /step < target\.group\.tabs\.length/);
  assert.match(source, /function activeTabMatches\(target: TabPosition, tab: vscode\.Tab\): boolean/);
  assert.match(source, /group\.tabs\.indexOf\(activeTab\) === target\.tabIndex/);
  assert.match(source, /sameIdentity\(targetIdentity\(activeTab\), targetIdentity\(tab\)\)/);
});
