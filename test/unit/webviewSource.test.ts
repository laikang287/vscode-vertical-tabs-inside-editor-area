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
  assert.match(webviewSource, /function showContextMenu\(x: number, y: number, tab\?: VerticalTabItem, group\?: VerticalTabDisplayGroup\)/);
  assert.match(webviewSource, /if \(tab\) \{\s*menu\.append\(\s*actionButton\('关闭其他标签'/);
  assert.match(webviewSource, /createGroupButton\(snapshot\?\.groupMode === 'manual'\)/);
  assert.match(webviewSource, /globalActionButton\('关闭已保存'/);
  assert.match(webviewSource, /globalActionButton\('关闭全部'/);
});

test('manual group rename is exposed from the group context menu and group delete uses the close icon column', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.doesNotMatch(source, /button\('重命名', '重命名分组'\)[\s\S]+header\.append\(rename/);
  assert.match(source, /showContextMenu\(event\.clientX, event\.clientY, undefined, group\)/);
  assert.match(source, /menu\.append\(renameGroupButton\(group\)\)/);
  assert.match(source, /const remove = button\('×', '删除分组'\)/);
  assert.match(source, /remove\.className = 'group-action tab-action'/);
  assert.match(source, /const main = document\.createElement\('div'\)/);
  assert.match(source, /main\.className = 'group-main'/);
  assert.match(style, /\.group-actions, \.tab-actions \{ align-items: center; display: flex; flex: 0 0 23px; justify-content: center; padding-right: 3px; \}/);
  assert.match(style, /\.group-header \.tab-action \{ line-height: 20px; min-width: 20px; padding: 0; \}/);
});

test('webview exposes grouping, sorting, bulk close, pinning, and drag messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /setGroupMode/);
  assert.match(source, /setSortMode/);
  assert.match(source, /closeAll/);
  assert.match(source, /pinTab/);
  assert.match(source, /unpinTab/);
  assert.match(source, /moveTab/);
  assert.doesNotMatch(source, /vscode\.postMessage\(\{ type: 'createGroupFromTabs'/);
});

test('manual group creation is disabled outside manual mode and accepted only in manual mode', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(webviewSource, /function createGroupButton\(enabled: boolean\): HTMLButtonElement/);
  assert.match(webviewSource, /result\.disabled = !enabled/);
  assert.match(webviewSource, /if \(!enabled\) return/);
  assert.match(panelSource, /创建手动标签分组失败：当前不是手动分组模式/);
  assert.doesNotMatch(panelSource, /this\.groupMode = 'manual';\s*await this\.context\.workspaceState\.update\(GROUP_MODE_STORAGE_KEY, this\.groupMode\);\s*\}\s*logInfo\('创建手动标签分组'/);
  assert.match(style, /\.tab-context-action:disabled/);
});

test('manual move group actions are grouped under a hover submenu', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /appendGroupSubmenu\(menu, '移至分组', '移动到手动分组'/);
  assert.match(source, /trigger\.className = 'tab-context-submenu-trigger'/);
  assert.match(source, /submenu\.className = 'tab-context-submenu-list'/);
  assert.match(source, /const item = button\(group\.name, `移至 \$\{group\.name\}`\)/);
  assert.doesNotMatch(source, /button\('移动分组'/);
  assert.doesNotMatch(source, /button\(`移至：\$\{group\.name\}`/);
  assert.match(style, /\.tab-context-submenu:hover \.tab-context-submenu-list/);
  assert.match(style, /\.tab-context-submenu-trigger::after/);
});

test('vscode mode context menu moves to existing groups without exposing new group', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(source, /messageButton\('移至新组'/);
  assert.match(source, /function appendVsCodeGroupActions\(menu: HTMLElement, tab: VerticalTabItem, displayGroups: readonly VerticalTabDisplayGroup\[\]\): void/);
  assert.match(source, /appendGroupSubmenu\(menu, '移至分组', '移动到 VS Code 编辑器组'/);
  assert.match(source, /type: 'moveToGroup', target: tab\.target, groupIndex: firstTarget\.groupIndex/);
  assert.match(panelSource, /message\.type === 'moveToGroup'/);
  assert.match(panelSource, /private async moveEditorToVsCodeGroup\(target: TabTarget, targetGroupIndex: number\): Promise<void>/);
  assert.match(panelSource, /private async moveActiveEditorToGroup\(sourceIdentity: TabTargetIdentity, destination: vscode\.TabGroup\): Promise<void>/);
  assert.match(panelSource, /vscode\.window\.tabGroups\.all\.indexOf\(destination\)/);
  assert.match(panelSource, /workbench\.action\.moveEditorToNextGroup/);
  assert.match(panelSource, /workbench\.action\.moveEditorToPreviousGroup/);
});

test('activation updates webview selection immediately and refreshes after navigation', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /markActiveTab\(tab\.target\)/);
  assert.match(source, /function markActiveTab\(target: TabTarget\): void/);
  assert.match(source, /parseTargetDataset\(candidate\.dataset\.target\)/);
  assert.match(source, /sameTarget\(candidateTarget, target\)/);
  assert.match(source, /\.tab-row\.is-active/);
  assert.match(panelSource, /await this\.activateTab\(tab, message\.requestId\);\s*await this\.refresh\(\{ reason: 'navigate' \}\);/);
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
  assert.match(source, /type: 'renderAck', revision: message\.snapshot\.revision/);
  assert.match(source, /标签渲染完成并发送确认/);
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
  assert.match(source, /MAX_EMPTY_RAIL_RESTORE_RATIO = 0\.3/);
  assert.match(source, /MAX_AUTO_APPLIED_RAIL_RATIO = 0\.3/);
  assert.match(source, /getEmptyRailRestoreRatio\(this\.context\)/);
  assert.match(source, /准备保存垂直标签栏宽度比例/);
  assert.match(source, /lastObservedRailWidth/);
  assert.match(source, /canPersistObservedRatio/);
  assert.match(source, /clampAutomaticRailRatio/);
  assert.match(source, /自动应用垂直标签栏宽度比例过大，已限制以避免压缩右侧编辑器组/);
});

test('extension logs and skips width application when a rail-sized root group already exists', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /function findExistingRailLikeRootGroup\(layout: EditorLayout, ratio: number\)/);
  assert.match(source, /准备调整左侧标签栏宽度/);
  assert.match(source, /existingRailLikeGroup/);
  assert.match(source, /跳过调整左侧标签栏宽度：当前布局中已有匹配目标比例的小宽度编辑器组/);
  assert.match(source, /应用左侧标签栏宽度布局/);
});

test('extension retries undelivered render messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /WEBVIEW_POST_RETRY_DELAY_MS = 250/);
  assert.match(source, /WEBVIEW_POST_MAX_ATTEMPTS = 8/);
  assert.match(source, /RENDER_ACK_TIMEOUT_MS = 1200/);
  assert.match(source, /RENDER_ACK_MAX_ATTEMPTS = 6/);
  assert.match(source, /private postMessage\(message: ExtensionMessage, attempt = 1\): void/);
  assert.match(source, /private scheduleRenderAckWatch\(snapshot: VerticalTabsSnapshot\): void/);
  assert.match(source, /等待 Webview 渲染确认超时，重新发送标签快照/);
  assert.match(source, /message\.type === 'renderAck'/);
  assert.match(source, /private disposed = false/);
  assert.match(source, /this\.disposed = true/);
  assert.match(source, /this\.disposed \|\| VerticalTabsPanel\.panels\.current !== this/);
  assert.match(source, /this\.postMessage\(message, attempt \+ 1\)/);
});

test('extension inlines the webview script to avoid local resource load failures', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /import \* as fs from 'node:fs'/);
  assert.match(source, /private readWebviewScript\(\): string/);
  assert.match(source, /fs\.readFileSync\(scriptPath, 'utf8'\)/);
  assert.match(source, /已内联读取 Webview 脚本/);
  assert.match(source, new RegExp(String.raw`<script nonce="\$\{nonce\}">\$\{scriptContent\}<\/script>`));
  assert.doesNotMatch(source, /src="\$\{scriptUri\}"/);
});

test('extension inlines the webview stylesheet and keeps nonce-only CSP', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /private readWebviewStyle\(\): string/);
  assert.match(source, /media', 'vertical-tabs\.css'/);
  assert.match(source, /fs\.readFileSync\(stylePath, 'utf8'\)/);
  assert.match(source, /已内联读取 Webview 样式/);
  assert.match(source, /读取 Webview 样式失败，将使用最小降级样式/);
  assert.match(source, /Webview 样式加载失败，请查看 Vertical Tabs 输出日志。/);
  assert.match(source, new RegExp(String.raw`style-src 'nonce-\$\{nonce\}'; script-src 'nonce-\$\{nonce\}'`));
  assert.match(source, new RegExp(String.raw`<style nonce="\$\{nonce\}">\$\{styleContent\}<\/style>`));
  assert.doesNotMatch(source, /<link rel="stylesheet"/);
  assert.doesNotMatch(source, /style-src \$\{cspSource\}/);
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

test('webview logs activation clicks with request ids and drags from the full tab row', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /let activateRequestSequence = 0/);
  assert.match(source, /let dragRequestSequence = 0/);
  assert.match(source, /row\.draggable = true/);
  assert.match(source, /row\.addEventListener\('dragstart'/);
  assert.match(source, /row\.addEventListener\('dragend'/);
  assert.match(source, /row\.dataset\.target = JSON\.stringify\(tab\.target\)/);
  assert.match(source, /标签拖拽开始/);
  assert.match(source, /application\/x-vertical-tab-drag-request/);
  assert.match(source, /标签拖拽排序请求/);
  assert.match(source, /标签拖拽结束/);
  assert.doesNotMatch(source, /标签拖拽创建分组请求/);
  assert.doesNotMatch(source, /const relativeY = /);
  assert.doesNotMatch(source, /const dragHandle = document\.createElement/);
  assert.match(source, /activate\.addEventListener\('pointerdown'/);
  assert.match(source, /标签激活按钮 pointerdown/);
  assert.match(source, /activate\.addEventListener\('click'/);
  assert.match(source, /const requestId = nextActivateRequestId\(\)/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'activateTab', target: tab\.target, requestId \}\)/);
  assert.doesNotMatch(source, /function suspendRowDrag/);
  assert.doesNotMatch(source, /suspendRowDrag\(row\)/);
  assert.match(source, /kind=\$\{target\.identity\.kind\}/);
});

test('webview styles the full tab row as draggable', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /\.tab-row \{ cursor: grab;/);
  assert.match(style, /\.tab-row:active \{ cursor: grabbing; \}/);
  assert.doesNotMatch(style, /\.tab-drag-handle/);
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

test('extension restores the active tab after syncing sorted VS Code tab order', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /const activeIdentity = this\.currentSnapshot\.tabs\.find\(\(tab\) => tab\.isActive\)\?\.target\.identity \?\? activeUserTabIdentity\(\)/);
  assert.match(source, /finally \{\s*await this\.restoreActiveTabAfterOrderSync\(activeIdentity\);/);
  assert.match(source, /private async restoreActiveTabAfterOrderSync\(identity: TabTargetIdentity \| undefined\): Promise<void>/);
  assert.match(source, /sameIdentity\(activeIdentity, identity\)/);
  assert.match(source, /await this\.activateTab\(tab, 'restore-active-after-sort'\)/);
  assert.match(source, /function activeUserTabIdentity\(\): TabTargetIdentity \| undefined/);
  assert.match(source, /function findTabByIdentity\(identity: TabTargetIdentity\): vscode\.Tab \| undefined/);
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

test('extension moves VS Code tabs repeatedly until the dropped position is reached', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /private async moveActiveEditorBeforeTarget\(sourceIdentity: TabTargetIdentity, beforeIdentity: TabTargetIdentity\): Promise<void>/);
  assert.match(source, /for \(let attempt = 0; attempt < 100; attempt \+= 1\)/);
  assert.match(source, /source\.tabIndex === before\.tabIndex - 1/);
  assert.match(source, /workbench\.action\.moveEditorLeftInGroup/);
  assert.match(source, /workbench\.action\.moveEditorRightInGroup/);
  assert.match(source, /移动命令未改变源标签位置/);
  assert.match(source, /private async moveActiveEditorToEndOfGroup\(sourceIdentity: TabTargetIdentity\): Promise<void>/);
  assert.match(source, /跟随 VS Code 模式移动到末尾完成/);
  assert.match(source, /function describeTabPosition\(position: TabPosition \| undefined\): Record<string, unknown> \| undefined/);
});
