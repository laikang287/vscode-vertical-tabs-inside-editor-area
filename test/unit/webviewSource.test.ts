import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('context menu close actions dismiss the menu after posting', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

 assert.match(source, /actionButton\(i18n\.close, i18n\.closeTab, 'closeTab', tab\.target, true\)/);
  assert.match(source, /messageButton\(i18n\.close, i18n\.closeTab, \{ type: 'closeTabs', targets \}\)/);
 assert.match(source, /actionButton\(i18n\.closeOthers, i18n\.closeOthers, 'closeOthers', tab\.target, true\)/);
  assert.match(source, /actionButton\(i18n\.closeBelow, i18n\.closeBelow, 'closeBelow', tab\.target, true\)/);
  assert.match(source, /closeOthersForTabs/);
  assert.match(source, /closeBelowForTabs/);
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
 assert.match(webviewSource, /if \(tab\) \{[\s\S]+actionButton\(i18n\.close/);
  assert.match(webviewSource, /messageButton\(i18n\.close, i18n\.closeGroup, \{ type: 'closeGroup', groupId: group\.id \}\)/);
 assert.match(webviewSource, /createGroupButton\(snapshot\?\.groupMode === 'manual'\)/);
  assert.match(webviewSource, /groupActionButton\(i18n\.closeSaved, i18n\.closeSavedTabs, 'closeSaved'/);
  assert.match(webviewSource, /groupActionButton\(i18n\.closeAll, i18n\.closeAllUnpinned, 'closeAll'/);
});

test('every visible group header has a close icon and manual rename stays in the context menu', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.doesNotMatch(source, /button\('重命名', '重命名分组'\)[\s\S]+header\.append\(rename/);
  assert.match(source, /showContextMenu\(event\.clientX, event\.clientY, undefined, group\)/);
 assert.match(source, /menu\.append\(renameGroupButton\(group\)\)/);
  assert.match(source, /const remove = iconButton\('close', i18n\.closeGroupAndDelete\)/);
 assert.match(source, /remove\.className = 'group-action tab-action'/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'closeGroup', groupId: group\.id \}\)/);
  assert.match(source, /if \(group\.isManual && group\.id !== '__ungrouped'\)/);
  assert.match(source, /header\.draggable = true/);
  assert.match(source, /draggedGroupId = group\.id/);
  assert.match(panelSource, /message\.type === 'deleteGroup' \|\| message\.type === 'closeGroup'/);
  assert.match(panelSource, /vscode\.window\.tabGroups\.close\(sourceGroup, true\)/);
  assert.match(panelSource, /this\.manualGroups\.splice\(manualGroupIndex, 1\)/);
  assert.match(source, /const main = document\.createElement\('div'\)/);
  assert.match(source, /main\.className = 'group-main'/);
  assert.match(style, /\.group-actions, \.tab-actions \{ align-items: center; display: flex; justify-content: center; \}/);
  assert.match(style, /\.group-actions \{ flex: 0 0 23px; padding-right: 3px; \}/);
  assert.match(style, /\.group-header \.tab-action \{ height: 20px; line-height: 20px; min-width: 20px; padding: 0; \}/);
});

test('group names preserve their original capitalization', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /\.group-name \{[\s\S]*?text-transform: none;[\s\S]*?\}/);
  assert.doesNotMatch(style, /\.group-name \{[\s\S]*?text-transform: uppercase;[\s\S]*?\}/);
});

test('tab close buttons are always visible and context menu labels use the requested short wording', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /\.tab-actions \{ opacity: 1; \}/);
  assert.doesNotMatch(style, /\.tab-actions[^\n]*opacity:\s*0/);
  assert.match(source, /actionButton\(i18n\.closeOthers, i18n\.closeOthers, 'closeOthers'/);
  assert.match(source, /actionButton\(i18n\.closeBelow, i18n\.closeBelow, 'closeBelow'/);
  assert.doesNotMatch(source, /关闭其它标签|关闭下侧标签/);
});

test('pinned tab icons render in a reserved left slot so peer labels stay aligned', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /pin\.className = 'tab-pin-slot'/);
  assert.match(source, /if \(tab\.isPinned\) pin\.append\(codicon\('pinned'\)\)/);
  assert.match(source, /activate\.append\(icon, pin, text\)/);
  assert.doesNotMatch(source, /tab\.label\}\$\{tab\.isPinned \? ' 📌' : ''\}/);
  assert.match(style, /\.tab-pin-slot \{ flex: 0 0 var\(--vertical-tab-pin-slot-width\);[\s\S]+text-align: center; \}/);
  assert.match(style, /\.tab-text \{[\s\S]+flex-direction: column;[\s\S]+min-width: 0;[\s\S]+?\}/);
});

test('dirty tabs render an accessible status indicator immediately before the close button', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.doesNotMatch(source, /tab\.isDirty \? '● ' : ''/);
  assert.match(source, /if \(tab\.isDirty\) \{[\s\S]+dirty\.className = 'tab-dirty-indicator'/);
  assert.match(source, /dirty\.title = i18n\.unsavedChanges/);
  assert.match(source, /dirty\.setAttribute\('aria-label', i18n\.unsavedChanges\)/);
  assert.match(source, /actions\.append\(dirty\);[\s\S]+actions\.append\(closeSelectionButton\(tab\)\)/);
  assert.match(style, /\.tab-actions \{ flex: 0 0 auto; min-width: var\(--vertical-tab-action-size\); padding-right: 0; \}/);
  assert.match(style, /\.tab-dirty-indicator \{[\s\S]+pointer-events: none;/);
});

test('compact tab spacing prioritizes label and path width without shrinking the close target', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /--vertical-tab-action-size: 22px;/);
  assert.match(style, /--vertical-tab-dirty-width: 8px;/);
  assert.match(style, /--vertical-tab-icon-size: 16px;/);
  assert.match(style, /--vertical-tab-inline-padding: 6px;/);
  assert.match(style, /--vertical-tab-item-gap: 2px;/);
  assert.match(style, /--vertical-tab-pin-slot-width: 12px;/);
  assert.match(style, /--vertical-tab-tree-indent: 12px;/);
  assert.match(style, /\.tab-row\.tree-level-1 \{ padding-left: var\(--vertical-tab-tree-indent\); \}/);
  assert.match(style, /\.tab-main \{[\s\S]+gap: var\(--vertical-tab-item-gap\);[\s\S]+padding: 2px 0 2px var\(--vertical-tab-inline-padding\);/);
  assert.match(style, /\.tab-icon \{[\s\S]+flex: 0 0 var\(--vertical-tab-icon-size\);[\s\S]+margin: 0;[\s\S]+width: var\(--vertical-tab-icon-size\);/);
  assert.match(style, /\.tab-label \{ flex: 1 1 auto; min-width: 0;[\s\S]+text-overflow: ellipsis;/);
  assert.match(style, /\.tab-dirty-indicator \{[\s\S]+flex: 0 0 var\(--vertical-tab-dirty-width\);/);
  assert.match(style, /\.tab-action \{[\s\S]+height: var\(--vertical-tab-action-size\);[\s\S]+min-width: var\(--vertical-tab-action-size\);/);
});

test('pinned groups render an indicator, sort first, and reject unsupported host messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /pin\.className = 'group-pin-indicator codicon codicon-pinned'/);
  assert.match(source, /pin\.setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(source, /pin\.textContent = '📌'/);
  assert.match(source, /const disabled = group\.mode === 'vscode'/);
  assert.match(panelSource, /!displayGroup \|\| !displayGroup\.showHeader \|\| displayGroup\.mode === 'vscode'/);
  assert.match(panelSource, /this\.pinnedGroupIds\.add\(message\.groupId\)/);
});

test('multi-selection drives batch close, pin, and cross-group drag messages through the host', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /const selection = new TabSelection\(\)/);
  assert.match(source, /selection\.update\(selectableTabs\(\), tab, keys\)/);
  assert.match(source, /preserveMultiSelectionOnPointerDown = true/);
  assert.match(source, /dragstart[\s\S]+draggedTargets = selectedTargetsFor\(tab\)/);
  assert.match(source, /type: 'closeTabs', targets/);
  assert.match(source, /type: pinned \? 'unpinTabs' : 'pinTabs', targets/);
  assert.match(source, /postTabMove\(targets, groupId/);
  assert.match(source, /const groupId = group\.mode === 'manual' && group\.id === '__ungrouped' \? undefined : group\.id/);
  assert.match(panelSource, /await this\.moveActiveEditorToGroup\(tab, destination\)/);
  assert.match(panelSource, /moveItemsBefore\(destinationTabs, movedKeys, beforeKey\)/);
  assert.match(style, /\.tab-row\.is-active \{\s*background: var\(--vscode-tab-unfocusedActiveBackground/);
  assert.match(style, /\.tab-row\.is-selected \{\s*background: var\(--vscode-list-inactiveSelectionBackground/);
});

test('tab colors distinguish selection, shown editors, and the focused editor', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(panelSource, /isFocused: tab\.isActive && tab\.group\.isActive/);
  assert.match(source, /tab\.isFocused \? 'is-focused' : ''/);
  assert.match(style, /\.tab-row\.is-selected \{\s*background: var\(--vscode-list-inactiveSelectionBackground/);
  assert.match(style, /\.tab-row\.is-active \{\s*background: var\(--vscode-tab-unfocusedActiveBackground/);
  assert.match(style, /\.tab-row\.is-focused \{\s*background: var\(--vscode-list-activeSelectionBackground\)/);
  assert.match(style, /\.tab-row\.is-focused::before \{[\s\S]+var\(--vscode-tab-activeBorderTop/);
});

test('active tab following is configurable and expands then reveals the focused tab', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const packageNls = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.nls.json'), 'utf8')) as Record<string, string>;
  const packageNlsZhCn = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { default: unknown; scope?: string; markdownDescription?: string }> } };
  };
  const setting = manifest.contributes.configuration.properties['verticalTabs.alwaysFollowActiveTab'];

  assert.equal(setting?.default, true);
  assert.equal(setting?.scope, 'window');
  assert.equal(setting?.markdownDescription, '%verticalTabs.config.alwaysFollowActiveTab%');
  assert.match(packageNls['verticalTabs.config.alwaysFollowActiveTab'] ?? '', /automatically expands its group and scrolls the tab into view/);
  assert.match(packageNlsZhCn['verticalTabs.config.alwaysFollowActiveTab'] ?? '', /自动展开其所属分组，并将对应标签滚动到可见区域/);
  assert.match(panelSource, /alwaysFollowActiveTab: readAlwaysFollowActiveTab\(\)/);
  assert.match(panelSource, /get<boolean>\('alwaysFollowActiveTab', true\)/);
  assert.match(webviewSource, /snapshot\.tabs\.find\(\(tab\) => tab\.isFocused\)/);
  assert.match(webviewSource, /activeTabFollowTracker\.shouldFollow\(focusedTab\?\.target, snapshot\.alwaysFollowActiveTab\)/);
  assert.match(webviewSource, /setDisplayGroupCollapsed\(focusedGroup, false, false\)/);
  assert.match(webviewSource, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
});

test('automatic-memory settings reset live state and avoid persisted width reads while disabled', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as { contributes: { configuration: { properties: Record<string, { default: unknown; enum?: readonly unknown[]; scope?: string; markdownDescription?: string }> } } };
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties['verticalTabs.rememberState']?.default, true);
  assert.equal(properties['verticalTabs.tabWidthRatio']?.default, 0.2);
  assert.equal(properties['verticalTabs.defaultGroupMode']?.default, 'vscode');
  assert.equal(properties['verticalTabs.defaultSortMode']?.default, 'none');
  assert.equal(properties['verticalTabs.defaultToolbarControlsVisible']?.default, true);
  assert.equal(properties['verticalTabs.toolbarPosition']?.default, 'top');
  assert.deepEqual(properties['verticalTabs.toolbarPosition']?.enum, ['top', 'bottom']);
  assert.equal(properties['verticalTabs.toolbarPosition']?.scope, 'window');
  assert.match(properties['verticalTabs.toolbarPosition']?.markdownDescription ?? '', /%verticalTabs\.config\.toolbarPosition%/);
  assert.match(properties['verticalTabs.tabWidthRatio']?.markdownDescription ?? '', /%verticalTabs\.config\.tabWidthRatio%/);
  assert.match(panelSource, /vscode\.workspace\.onDidChangeConfiguration/);
  assert.match(panelSource, /this\.manualGroups\.splice\(0, this\.manualGroups\.length\)/);
  assert.match(panelSource, /this\.toolbarControlsVisible = readDefaultToolbarControlsVisible\(\)/);
  assert.match(panelSource, /this\.persistToolbarControlsVisible\(\)/);
  assert.match(panelSource, /const savedRatio = shouldRememberState\(\) \? context\.globalState\.get<number>\(WIDTH_RATIO_STORAGE_KEY\) : undefined/);
});

test('directory and relative path display is configurable and uses a subdued second line', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');
  const packageNls = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.nls.json'), 'utf8')) as Record<string, string>;
  const packageNlsZhCn = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { default: unknown; enum?: readonly string[]; enumItemLabels?: readonly string[] }> } };
  };
  const setting = manifest.contributes.configuration.properties['verticalTabs.relativePathDisplay'];

  assert.equal(setting?.default, 'off');
  assert.deepEqual(setting?.enum, ['off', 'duplicatesDirectory', 'duplicates', 'alwaysDirectory', 'always']);
  assert.deepEqual(setting?.enumItemLabels, [
    '%verticalTabs.config.relativePathDisplay.label.off%',
    '%verticalTabs.config.relativePathDisplay.label.duplicatesDirectory%',
    '%verticalTabs.config.relativePathDisplay.label.duplicates%',
    '%verticalTabs.config.relativePathDisplay.label.alwaysDirectory%',
    '%verticalTabs.config.relativePathDisplay.label.always%',
  ]);
  assert.match(panelSource, /relativePathDisplay: readRelativePathDisplay\(\)/);
  assert.match(panelSource, /directoryName: inputDirectoryName\(tab\.input\)/);
  assert.match(panelSource, /function inputDirectoryName/);
  assert.match(panelSource, /function inputWorkspaceRelativePath/);
  assert.match(panelSource, /vscode\.workspace\.getWorkspaceFolder\(uri\)/);
  assert.match(webviewSource, /detail\.className = 'tab-description'/);
  assert.match(style, /\.tab-description \{[^}]*font-size: 10px;[^}]*opacity: \.82;/);
  assert.equal(packageNlsZhCn['verticalTabs.config.relativePathDisplay.label.off'], '不显示（默认）');
  assert.equal(packageNlsZhCn['verticalTabs.config.relativePathDisplay.label.duplicatesDirectory'], '仅同名文件时显示目录名');
  assert.equal(packageNlsZhCn['verticalTabs.config.relativePathDisplay.label.duplicates'], '仅同名文件时显示相对仓库路径');
  assert.equal(packageNlsZhCn['verticalTabs.config.relativePathDisplay.label.alwaysDirectory'], '始终显示目录名');
  assert.equal(packageNlsZhCn['verticalTabs.config.relativePathDisplay.label.always'], '始终显示相对仓库的路径');
  assert.equal(typeof packageNls['verticalTabs.config.relativePathDisplay.label.duplicatesDirectory'], 'string');
});

test('editor-area position setting supports live left and right placement with a safe fallback', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    contributes: { configuration: { properties: Record<string, { default: unknown; enum?: unknown[]; scope?: string }> } };
  };
  const position = manifest.contributes.configuration.properties['verticalTabs.position'];

  assert.equal(position?.default, 'left');
  assert.deepEqual(position?.enum, ['left', 'right']);
  assert.equal(position?.scope, 'window');
  assert.match(panelSource, /return value === 'right' \? 'right' : 'left'/);
  assert.match(panelSource, /event\.affectsConfiguration\('verticalTabs\.position'\)/);
  assert.match(panelSource, /workbench\.action\.moveActiveEditorGroupLeft/);
  assert.match(panelSource, /workbench\.action\.moveActiveEditorGroupRight/);
  assert.match(panelSource, /selectWidestEditorGroupViewColumn/);
  assert.match(panelSource, /this\.railPosition === 'left'[\s\S]+newGroupRight[\s\S]+newGroupLeft/);
});

test('adjacent navigation reuses an open panel without stealing the active editor focus', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(
    panelSource,
    /const instance = VerticalTabsPanel\.panels\.current \?\? await VerticalTabsPanel\.open\(context\);[\s\S]+await instance\?\.navigate\(direction\)/,
  );
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

test('toolbar exposes labeled grouping and sorting selectors plus icon tree actions', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(panelSource, /id="expand-all"[^>]+aria-label=""><span class="codicon codicon-expand-all" aria-hidden="true"><\/span><\/button>/);
 assert.match(panelSource, /id="collapse-all"[^>]+aria-label=""><span class="codicon codicon-collapse-all" aria-hidden="true"><\/span><\/button>/);
  assert.match(panelSource, /<span>\$\{i18n\.groupModeLabel\}<\/span><select id="group-mode">/);
  assert.match(panelSource, /<span>\$\{i18n\.sortModeLabel\}<\/span><select id="sort-mode">/);
  assert.match(panelSource, /<option value="none">\$\{i18n\.sortModeNone\}<\/option>/);
 assert.match(webviewSource, /querySelector<HTMLSelectElement>\('#group-mode'\)/);
  assert.match(webviewSource, /querySelector<HTMLSelectElement>\('#sort-mode'\)/);
  assert.match(webviewSource, /querySelector<HTMLElement>\('#toolbar-controls'\)/);
  assert.match(webviewSource, /querySelector<HTMLButtonElement>\('#toggle-toolbar-controls'\)/);
  assert.match(webviewSource, /type: 'setGroupMode', groupMode: groupModeSelect\.value as GroupMode/);
  assert.match(webviewSource, /type: 'setSortMode', sortMode: sortModeSelect\.value as SortMode/);
  assert.match(webviewSource, /type: 'setToolbarControlsVisible', visible/);
  assert.match(webviewSource, /setToolbarControlsVisible\(message\.snapshot\.toolbarControlsVisible\)/);
  assert.match(panelSource, /id="toggle-toolbar-controls"/);
  assert.match(panelSource, /id="toolbar-controls" class="toolbar-selects"/);
  assert.doesNotMatch(webviewSource, /appendGroupSubmenu\(menu, '分组方式'/);
  assert.doesNotMatch(webviewSource, /appendGroupSubmenu\(menu, '排序方式'/);
});

test('webview renders Seti file icons and Codicon actions in a compact two-line layout', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /function createTabIcon\(tab: VerticalTabItem\): HTMLSpanElement/);
  assert.match(source, /icon\.className = 'tab-icon tab-seti-icon'/);
  assert.match(source, /const result = iconButton\('close', i18n\.closeTab\)/);
  assert.match(source, /codicon\('pinned'\)/);
  assert.match(source, /tab\.isPreview \? 'is-preview' : ''/);
  assert.match(source, /activate\.append\(icon, pin, text\)/);
  assert.match(source, /activate\.setAttribute\('aria-label', tabAccessibleLabel\(tab\)\)/);
  assert.match(source, /icon\.setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(source, /button\('×'|textContent = '📌'|button\(collapsed \? '▶' : '▼'/);
  assert.match(panelSource, /codicon-search/);
  assert.match(panelSource, /codicon-settings-gear/);
  assert.match(style, /\.tab-seti-icon \{ font-family: "seti"; font-size: 150%; \}/);
  assert.match(style, /\.tab-text \{[\s\S]+flex-direction: column/);
  assert.match(style, /\.tab-row\.has-description \.tab-main/);
  assert.match(style, /\.tab-row\.is-preview \.tab-label \{ font-style: italic; \}/);
});

test('manual group creation is disabled outside manual mode and accepted only in manual mode', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(webviewSource, /function createGroupButton\(enabled: boolean\): HTMLButtonElement/);
  assert.match(webviewSource, /result\.disabled = !enabled/);
  assert.match(webviewSource, /if \(!enabled\) return/);
  assert.match(webviewSource, /vscode\.postMessage\(\{ type: 'requestCreateGroup' \}\)/);
  assert.doesNotMatch(webviewSource, /window\.prompt\('分组名称'\)/);
  assert.match(panelSource, /vscode\.window\.showInputBox/);
  assert.match(panelSource, /创建手动标签分组失败：当前不是手动分组模式/);
  assert.doesNotMatch(panelSource, /this\.groupMode = 'manual';\s*await this\.context\.workspaceState\.update\(GROUP_MODE_STORAGE_KEY, this\.groupMode\);\s*\}\s*logInfo\('创建手动标签分组'/);
  assert.match(style, /\.tab-context-action:disabled/);
});

test('context menu hides manual move-to-group actions', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.doesNotMatch(source, /appendManualGroupActions/);
  assert.doesNotMatch(source, /移动到手动分组/);
  assert.doesNotMatch(source, /type: 'assignGroup'/);
});

test('vscode mode context menu hides adjacent group moves and move-to-group submenu', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(source, /messageButton\('移至新组'/);
  assert.doesNotMatch(source, /appendVsCodeGroupActions/);
  assert.doesNotMatch(source, /移动到 VS Code 编辑器组/);
  assert.doesNotMatch(source, /messageButton\('移至上一组'/);
  assert.doesNotMatch(source, /messageButton\('移至下一组'/);
  assert.match(panelSource, /message\.type === 'moveToGroup'/);
  assert.match(panelSource, /private async moveEditorToVsCodeGroup\(target: TabTarget, targetGroupIndex: number\): Promise<void>/);
  assert.match(panelSource, /private async moveActiveEditorToGroup\(sourceTab: vscode\.Tab, destination: vscode\.TabGroup\): Promise<void>/);
  assert.match(panelSource, /groupsBefore\.indexOf\(destination\)/);
  assert.match(panelSource, /const targetViewColumn = destination\.viewColumn/);
  assert.match(panelSource, /vscode\.commands\.executeCommand\('moveActiveEditor', \{\s*to: 'position',\s*by: 'group',\s*value: targetViewColumn,/);
  assert.doesNotMatch(panelSource, /value: targetGroupIndex \+ 1/);
  assert.match(panelSource, /if \(groupsAfter\.length > groupCountBefore\)/);
  const absoluteMoveMethod = panelSource.match(/private async moveActiveEditorToGroup[\s\S]+?\n  \}\n\n  private async moveActiveEditorBeforeTarget/)?.[0] ?? '';
  assert.doesNotMatch(absoluteMoveMethod, /moveEditorToNextGroup|moveEditorToPreviousGroup/);
});

test('activation updates the focused editor without clearing shown tabs in other groups', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

 assert.match(source, /markActiveTab\(target\)/);
 assert.match(source, /function markActiveTab\(target: TabTarget\): void/);
  assert.match(source, /parseTargetDataset\(candidate\.dataset\.target\)/);
  assert.match(source, /sameTarget\(candidateTarget, target\)/);
  assert.match(source, /\.tab-row\.is-active/);
  assert.match(source, /\.tab-row\.is-focused/);
  assert.match(source, /candidateTarget\?\.groupIndex === target\.groupIndex/);
  assert.match(source, /classList\.add\('is-active', 'is-focused'\)/);
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

test('extension restores the prepared rail layout without a fixed visible delay', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(source, /RAIL_SETTLE_DELAY_MS/);
  assert.match(source, /const initialGroupIndex = await this\.waitForOwnGroup\(\)/);
  assert.match(source, /const preparedRailGroup = await prepareRailGroup\(context, position\)[\s\S]+vscode\.window\.createWebviewPanel/);
  assert.match(source, /const layoutAppliedBeforePanel = canApplyBeforePanel[\s\S]+applyRailRatio\(ratio, position, previousLayout\)/);
  assert.match(source, /return \{ ratio, viewColumn, previousLayout, layoutAppliedBeforePanel \}/);
  assert.match(source, /if \(!preparedRailGroup\.layoutAppliedBeforePanel\)[\s\S]+setTimeout\(resolve, GROUP_WAIT_INTERVAL_MS\)[\s\S]+applyRailRatio\(preparedRailGroup\.ratio, this\.railPosition, preparedRailGroup\.previousLayout\)/);
  assert.match(source, /宽度已在 Webview 显示前应用，跳过显示后的布局等待和重复写入/);
});

test('rail creation avoids activating a narrow edge editor before restoring widths', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const prepareStart = source.indexOf('async function prepareRailGroup(');
  const prepareEnd = source.indexOf('function getConfiguredRailRatio(', prepareStart);
  const prepareSource = source.slice(prepareStart, prepareEnd);

  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart);
  assert.match(prepareSource, /selectWidestEditorGroupViewColumn\(/);
  assert.match(prepareSource, /moveActiveEmptyGroupToRailEdge\(position\)/);
  assert.doesNotMatch(prepareSource, /workbench\.action\.focusFirstEditorGroup/);
  assert.doesNotMatch(prepareSource, /workbench\.action\.focusLastEditorGroup/);
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
  assert.match(source, /自动应用垂直标签栏宽度比例过大，已限制以避免过度压缩用户编辑器组/);
});

test('extension logs and skips width application when a rail-sized root group already exists', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /function findExistingRailLikeRootGroup\([\s\S]+position: RailPosition/);
  assert.match(source, /getRailRootGroupIndex\(layout, position\)/);
  assert.match(source, /existingRailLikeGroup/);
  assert.match(source, /const railGroup = sizedGroups\.find\(\(group\) => group\.index === railIndex\)/);
  assert.match(source, /if \(railRatio > MAX_EMPTY_RAIL_RESTORE_RATIO\) return undefined/);
  assert.doesNotMatch(source, /candidate\.ratio >= 0\.6/);
  assert.match(source, /setRailRootGroupWidth\(layout, railWidth, position\)/);
});

test('extension keeps the native new-group layout when preserved rail allocation is unsafe', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /widthContributions: describeRailWidthContributions\(previousLayout, preservedLayout, position\)/);
  assert.match(
    source,
    /if \(previousLayout && countLayoutLeaves\(layout\) === countLayoutLeaves\(previousLayout\) \+ 1\)[\s\S]+if \(preservedLayout\)[\s\S]+return applyEditorLayout\(preservedLayout\);[\s\S]+return true;\s*}\s*const existingRailLikeGroup/,
  );
});

test('extension returns rail width to its original editor donors when hidden', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /await this\.captureCloseLayoutRestore\(preparedRailGroup\?\.previousLayout\)/);
  assert.match(source, /removeRailRestoringEditorWidths\(currentLayout, this\.railPosition, contributions\)/);
  assert.match(
    source,
    /vscode\.window\.tabGroups\.close\(group, true\)[\s\S]+waitForEditorLayoutLeafCount\(countLayoutLeaves\(restoredLayout\)\)[\s\S]+applyEditorLayout\(restoredLayout\)/,
  );
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

test('extension inlines styles and restricts icon fonts to local Webview resources', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /private readWebviewStyle\(\): string/);
  assert.match(source, /media', 'vertical-tabs\.css'/);
  assert.match(source, /fs\.readFileSync\(stylePath, 'utf8'\)/);
  assert.match(source, /已内联读取 Webview 样式与图标字体/);
  assert.match(source, /读取 Webview 样式失败，将使用最小降级样式/);
  assert.match(source, /Webview 样式加载失败，请查看 Vertical Tabs 输出日志。/);
  assert.match(source, /font-src \$\{this\.panel\.webview\.cspSource\}/);
  assert.match(source, new RegExp(String.raw`style-src 'nonce-\$\{nonce\}'; script-src 'nonce-\$\{nonce\}'`));
  assert.match(source, new RegExp(String.raw`<style nonce="\$\{nonce\}">\$\{styleContent\}<\/style>`));
  assert.doesNotMatch(source, /<link rel="stylesheet"/);
  assert.doesNotMatch(source, /style-src \$\{cspSource\}/);
  assert.match(source, /node_modules\/@vscode\/codicons|out', 'codicon\.css'/);
  assert.match(source, /out', 'codicon\.ttf'/);
  assert.match(source, /webview\.asWebviewUri\(setiFontPath\)/);
  assert.match(source, /vscode\.env\.appRoot\), 'extensions', 'theme-seti', 'icons'/);
  assert.match(source, /localResourceRoots\.push\(setiRoot\)/);
  assert.match(source, /this\.panel\.webview\.options = createWebviewOptions\(context\)/);
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

test('webview collapses an existing multi-selection on click while retaining block dragging and keyboard activation', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /let activateRequestSequence = 0/);
  assert.match(source, /let dragRequestSequence = 0/);
  assert.match(source, /row\.draggable = currentDragCapability\(\) !== 'disabled'/);
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
  assert.match(source, /activate\.addEventListener\('pointerup'/);
  assert.match(source, /if \(event\.button !== 0\) return/);
  assert.match(source, /标签激活按钮发送单次激活请求/);
  assert.match(source, /activate\.addEventListener\('click'/);
  assert.match(source, /if \(event\.detail === 0\) \{\s*selectSingle\(tab\);\s*requestActivation\(\);/);
  assert.match(source, /preserveMultiSelectionOnPointerDown = true;[\s\S]+?activate\.setPointerCapture\(event\.pointerId\);\s*return;/);
 assert.match(source, /const collapsePreservedMultiSelection = \(\) => \{[\s\S]+?preserveMultiSelectionOnPointerDown = false;[\s\S]+?selectSingle\(tab\);[\s\S]+?requestActivation\(\);/);
  assert.match(source, /if \(preserveMultiSelectionOnPointerDown && !draggedAfterPreservePointerDown\) \{\s*collapsePreservedMultiSelection\(\);/);
  assert.match(source, /if \(preserveMultiSelectionOnPointerDown\) draggedAfterPreservePointerDown = true/);
  assert.match(source, /activate\.setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /const cancelledPreservedDrag = preserveMultiSelectionOnPointerDown[\s\S]+?dropEff === 'none'/);
  assert.match(source, /if \(cancelledPreservedDrag\) \{[\s\S]+?draggedAfterPreservePointerDown = false;[\s\S]+?collapsePreservedMultiSelection\(\);/);
  assert.match(source, /classList\.remove\('is-selected', 'is-multi-selected'\)/);
 assert.match(source, /const requestId = nextActivateRequestId\(\)/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'activateTab', target, requestId \}\)/);
 assert.doesNotMatch(source, /function suspendRowDrag/);
  assert.doesNotMatch(source, /suspendRowDrag\(row\)/);
  assert.match(source, /kind=\$\{target\.identity\.kind\}/);
  assert.match(source, /findCurrentTabByIdentity/);
  assert.match(source, /findCurrentTabByIdentity\(tab\.target\.identity\)/);
});

test('toolbar position setting fixes the toolbar at either edge and reverses only bottom section order', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');
  const packageNls = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.nls.json'), 'utf8')) as Record<string, string>;
  const packageNlsZhCn = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;

  assert.match(panelSource, /type ToolbarPosition/);
  assert.match(panelSource, /this\.toolbarPosition = readToolbarPosition\(\)/);
  assert.match(panelSource, /event\.affectsConfiguration\('verticalTabs\.toolbarPosition'\)/);
  assert.match(panelSource, /toolbarPosition: this\.toolbarPosition/);
  assert.match(panelSource, /data-toolbar-position="\$\{this\.toolbarPosition\}"/);
  assert.match(panelSource, /<div class="toolbar-actions">[\s\S]+?<div id="toolbar-controls" class="toolbar-selects">[\s\S]+?<div id="search-container" class="search-container">/);
  assert.match(webviewSource, /verticalTabs\.dataset\.toolbarPosition = message\.snapshot\.toolbarPosition/);
  assert.match(style, /\.vertical-tabs \{[\s\S]+display: flex;[\s\S]+height: 100vh;[\s\S]+overflow: hidden;/);
  assert.match(style, /\.vertical-tabs\[data-toolbar-position="bottom"\] \.toolbar \{[\s\S]+flex-direction: column-reverse;[\s\S]+order: 2;/);
  assert.match(style, /#groups \{[\s\S]+flex: 1 1 auto;[\s\S]+min-height: 0;[\s\S]+overflow-y: auto;/);
  assert.equal(typeof packageNls['verticalTabs.config.toolbarPosition'], 'string');
  assert.equal(typeof packageNlsZhCn['verticalTabs.config.toolbarPosition'], 'string');
});

test('webview only shows the drag cursor on draggable tab rows', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /\.tab-row\[draggable="true"\] \{ cursor: grab; \}/);
  assert.match(style, /\.tab-row\[draggable="true"\]:active \{ cursor: grabbing; \}/);
  assert.doesNotMatch(style, /\.tab-drag-handle/);
});

test('webview and host enforce drag capabilities for grouping and sorting modes', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(webviewSource, /const beforeTarget = canReorderTabs\(capability\) \? beforeTargetForDrop/);
  assert.match(webviewSource, /targetsForDrop\(group\)/);
  assert.match(webviewSource, /!group\.tabs\.some\(\(tab\) => sameTarget\(tab\.target, target\)\)/);
  assert.match(panelSource, /const dragCapability = tabDragCapability\(this\.groupMode, this\.sortMode\)/);
  assert.match(panelSource, /if \(dragCapability === 'disabled'\)/);
  assert.match(panelSource, /const beforeTarget = canReorderTabs\(dragCapability\) \? message\.beforeTarget : undefined/);
  assert.match(panelSource, /moveParentDirectoryTabs/);
  assert.match(panelSource, /if \(this\.sortMode !== 'none'\) \{\s*logInfo\('跟随 VS Code 模式标签仅更改分组'/);
  assert.doesNotMatch(panelSource, /this\.groupMode = 'manual';\s*await this\.persistGroupMode\(\);\s*await this\.moveManualTab/);
});

test('webview keeps the grabbed point aligned with the pointer while dragging', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /interface DragImageOffset/);
  assert.match(source, /row\.addEventListener\('pointerdown',[\s\S]+dragImageOffset = dragImageOffsetWithin\(row, event\.clientX, event\.clientY\);\s*\}, \{ capture: true \}\)/);
  assert.match(source, /const hotspot = dragImageOffset \?\? dragImageOffsetWithin\(row, event\.clientX, event\.clientY\)/);
  assert.match(source, /setDragImage\(row, hotspot\.x, hotspot\.y\)/);
  assert.match(source, /dragImageOffset = undefined/);
  assert.match(source, /x: clamp\(clientX - bounds\.left, 0, bounds\.width\)/);
  assert.match(source, /y: clamp\(clientY - bounds\.top, 0, bounds\.height\)/);
  assert.doesNotMatch(source, /setDragImage\(row, 8, 8\)/);
});

test('extension selects existing tabs without cycling through intermediate tabs', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /private async selectExistingTab\(tab: vscode\.Tab, requestId\?: string\): Promise<boolean>/);
  assert.match(source, /workbench\.action\.openEditorAtIndex\$\{target\.tabIndex \+ 1\}/);
  assert.doesNotMatch(source, /workbench\.action\.nextEditorInGroup/);
  assert.doesNotMatch(source, /step < target\.group\.tabs\.length/);
  assert.match(source, /避免循环切换中间标签/);
  assert.match(source, /function activeTabMatches\(target: TabPosition, tab: vscode\.Tab\): boolean/);
  assert.match(source, /group\.tabs\.indexOf\(activeTab\) === target\.tabIndex/);
  assert.match(source, /sameIdentity\(targetIdentity\(activeTab\), targetIdentity\(tab\)\)/);
});

test('extension resolves close targets by stable identity and retries failed bulk closes individually', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(source, /同一快照版本内按索引解析标签目标/);
  assert.match(source, /sameIdentity\(targetIdentity\(indexedTab\), target\.identity\)/);
  assert.match(source, /const closed = await vscode\.window\.tabGroups\.close\(tabs, true\)/);
  assert.match(source, /批量关闭未全部成功，按稳定标签标识逐项重试/);
  assert.match(source, /const retryTab = this\.resolveTab\(target\)/);
  assert.match(source, /retryTab && !retryTab\.isDirty/);
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

test('manual grouping places newly opened tabs at the root manual-order tail', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /vscode\.window\.tabGroups\.onDidChangeTabs\(\(event\) =>/);
  assert.match(source, /private applyManualGroupLifecycle\(event: vscode\.TabChangeEvent\): boolean/);
  assert.match(source, /for \(const tab of event\.closed\)[\s\S]+?this\.clearManualGroupIdentity\(targetIdentity\(tab\)\)/);
  assert.match(source, /const openedGroupId = undefined/);
  assert.match(source, /for \(const tab of event\.opened\)[\s\S]+?this\.setManualGroup\(identity, openedGroupId\)/);
  assert.match(source, /this\.insertManualOrder\(openedGroupId \?\? '__ungrouped', key, undefined\)/);
  assert.doesNotMatch(source, /manualInsertionGroupId/);
  assert.doesNotMatch(source, /focusedManualGroupIdFromSnapshot/);
  assert.doesNotMatch(source, /focusedManualGroupIdFromLiveTabs/);
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

test('extension reorders a multi-select VS Code drag as one stable block', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /跟随 VS Code 模式批量移动失败：目标编辑器组已失效/);
  assert.match(source, /const desiredTabs = moveItemsBefore\(destinationTabs, movedTabsInDestination, beforeTab\)/);
  assert.match(source, /await this\.syncVsCodeGroupTabOrder\(stableDestination, desiredTabs\)/);
  assert.match(source, /跟随 VS Code 模式批量移动完成并抵达投放位置/);
  assert.doesNotMatch(source, /跟随 VS Code 模式批量移动完成：仅移动至目标编辑器组/);
});

test('tab-row drop stops before the outer group can append the same drag to the end', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /function handleTabDrop[\s\S]+?event\.preventDefault\(\);\s*\/\/[\s\S]+?event\.stopPropagation\(\);[\s\S]+?const beforeTarget = canReorderTabs\(capability\) \? beforeTargetForDrop/);
  assert.match(source, /function handleTabDragOver[\s\S]+?event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
});

test('dragging shows a bright insertion line at the exact before or after edge', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /dragInsertionEdge\(event\.clientY, bounds\.top, bounds\.height\)/);
  assert.match(source, /edge === 'before' \? bounds\.top : bounds\.bottom/);
  assert.match(source, /function beforeTargetForDrop[\s\S]+group\.tabs\.slice\(tabIndex \+ 1\)/);
  assert.match(source, /document\.addEventListener\('dragend', \(\) => \{ clearDropIndicator\(\); draggedGroupId = undefined; \}\)/);
  assert.match(style, /\.tab-drop-indicator \{[\s\S]+background: var\(--vscode-focusBorder, #007fd4\);[\s\S]+height: 2px;/);
});

test('dragging to a group without a precise position highlights the group instead of an insertion line', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /function handleGroupDragOver[\s\S]+showGroupDropHighlight\(event\.currentTarget as HTMLElement\)/);
  assert.match(source, /capability === 'moveGroup' \|\| capability === 'moveDirectory'[\s\S]+showGroupDropHighlight\(row\.closest<HTMLElement>\('\.tab-group'\) \?\? row\)/);
  assert.doesNotMatch(source, /function showGroupEndDropIndicator/);
  assert.match(source, /function showGroupDropHighlight[\s\S]+classList\.add\('is-drop-target'\)/);
  assert.match(source, /function clearGroupDropHighlight[\s\S]+classList\.remove\('is-drop-target'\)/);
  assert.match(style, /\.tab-group\.is-drop-target > \.group-header \{[\s\S]+outline: 1px solid var\(--vscode-focusBorder, #007fd4\);/);
});

test('parent-directory file collisions require confirmation and replace related tabs', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /const destinationExists = await resourceExists\(destinationUri\)/);
  assert.match(source, /showWarningMessage\([\s\S]+\{ modal: true, detail \}[\s\S]+['"]覆盖['"]/);
  assert.match(source, /await vscode\.window\.tabGroups\.close\(destinationTabs, true\)/);
  assert.match(source, /workspace\.fs\.rename\(sourceUri, destinationUri, \{ overwrite: destinationExists \}\)/);
  assert.match(source, /await this\.openMovedResource\(sourceInput, tab\.label, destinationUri, replacementViewColumn\)/);
  assert.match(source, /const duplicateTabs = replacementTab \? openedDestinationTabs\.filter/);
  assert.match(source, /const staleSourceTabs = findTabsByResourceUri\(sourceUri\)/);
});


test('search input, group toggle, and search visibility toggle are present in the panel template', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(panelSource, /id="toggle-search"/);
  assert.match(panelSource, /id="search-container"/);
  assert.match(panelSource, /id="search-input"/);
  assert.match(panelSource, /id="search-group-toggle"/);
  assert.ok(webviewSource.includes("querySelector<HTMLInputElement>('#search-input')"));
  assert.ok(webviewSource.includes("querySelector<HTMLButtonElement>('#search-group-toggle')"));
  assert.ok(webviewSource.includes("querySelector<HTMLButtonElement>('#toggle-search')"));
  assert.ok(webviewSource.includes("querySelector<HTMLElement>('#search-container')"));
  assert.ok(webviewSource.includes("type: 'setSearchVisible'"));
  assert.ok(webviewSource.includes("type: 'setSearchGroups'"));
  assert.match(webviewSource, /function applySearchFilter/);
  assert.match(webviewSource, /function applyCurrentFilter/);
  assert.match(webviewSource, /function setSearchContainerVisible/);
  assert.match(panelSource, /searchVisible:/);
  assert.match(panelSource, /searchGroups:/);
  assert.match(panelSource, /SEARCH_VISIBLE_STORAGE_KEY/);
  assert.match(panelSource, /SEARCH_GROUPS_STORAGE_KEY/);
});
