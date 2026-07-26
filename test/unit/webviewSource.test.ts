import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('sidebar launcher stays compact and localizes fallback show and hide actions in every supported language', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    contributes: {
      commands: Array<{ command: string; title: string; icon?: string }>;
      views: Record<string, Array<{ id: string; visibility?: string; initialSize?: number }>>;
      viewsWelcome: Array<{ view: string; when?: string; contents: string }>;
      menus?: { 'view/title'?: Array<{ command: string; when: string; group: string }> };
    };
  };
  const launcher = manifest.contributes.views['vertical-tabs-activitybar']?.find((view) => view.id === 'verticalTabs.launcher');
  const openCommand = manifest.contributes.commands.find((command) => command.command === 'verticalTabs.open');
  const closeCommand = manifest.contributes.commands.find((command) => command.command === 'verticalTabs.close');

  assert.equal(launcher?.visibility, 'collapsed');
  assert.equal(launcher?.initialSize, 1);
  assert.deepEqual(openCommand, {
    command: 'verticalTabs.open',
    title: '%verticalTabs.command.open%',
  });
  assert.deepEqual(closeCommand, {
    command: 'verticalTabs.close',
    title: '%verticalTabs.command.close%',
  });
  assert.deepEqual(manifest.contributes.viewsWelcome, [
    {
      view: 'verticalTabs.launcher',
      when: '!verticalTabs.visible',
      contents: '%verticalTabs.launcher.show%',
    },
    {
      view: 'verticalTabs.launcher',
      when: 'verticalTabs.visible',
      contents: '%verticalTabs.launcher.hide%',
    },
  ]);
  assert.equal(manifest.contributes.menus?.['view/title'], undefined);

  for (const locale of ['en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'de', 'fr', 'es', 'pt-br', 'ru']) {
    const suffix = locale === 'en' ? '' : `.${locale}`;
    const messages = JSON.parse(readFileSync(path.resolve(__dirname, `../../../package.nls${suffix}.json`), 'utf8')) as Record<string, string>;
    assert.ok(messages['verticalTabs.command.open'], `${locale} should localize the show command title.`);
    assert.ok(messages['verticalTabs.command.close'], `${locale} should localize the hide command title.`);
    assert.match(messages['verticalTabs.launcher.show'] ?? '', /^\[[^\]]+\]\(command:verticalTabs\.open\)$/);
    assert.match(messages['verticalTabs.launcher.hide'] ?? '', /^\[[^\]]+\]\(command:verticalTabs\.close\)$/);
  }
});

test('all manifest-facing labels use package NLS placeholders', () => {
  const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    displayName: string;
    description: string;
    contributes: {
      commands: Array<{ command: string; title: string }>;
      configuration: { title: string };
      viewsContainers: { activitybar: Array<{ title: string }> };
      views: Record<string, Array<{ name: string }>>;
    };
  };

  assert.match(manifest.displayName, /^%[^%]+%$/);
  assert.match(manifest.description, /^%[^%]+%$/);
  for (const command of manifest.contributes.commands) {
    assert.match(command.title, /^%[^%]+%$/, `${command.command} title must use package NLS`);
  }
  assert.match(manifest.contributes.configuration.title, /^%[^%]+%$/);
  for (const container of manifest.contributes.viewsContainers.activitybar) {
    assert.match(container.title, /^%[^%]+%$/);
  }
  for (const view of Object.values(manifest.contributes.views).flat()) {
    assert.match(view.name, /^%[^%]+%$/);
  }
});

test('extension-host prompts, accessibility labels, and Webview fallbacks use runtime i18n', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const nativeMenuSource = readFileSync(path.resolve(__dirname, '../../../src/webview/NativeTabMenu.ts'), 'utf8');

  assert.match(panelSource, /prompt: this\.localeStrings\.groupNamePrompt/);
  assert.match(panelSource, /placeHolder: this\.localeStrings\.groupName/);
  assert.match(panelSource, /this\.localeStrings\.groupNameRequired/);
  assert.match(panelSource, /format\(this\.localeStrings\.groupNameTooLong, 80\)/);
  assert.match(panelSource, /format\(this\.localeStrings\.nativeMenuActionFailed, action\.command\)/);
  assert.match(panelSource, /format\(this\.localeStrings\.overwriteFileConfirm, path\.posix\.basename/);
  assert.match(panelSource, /this\.localeStrings\.overwriteFileDirtyDetail/);
  assert.match(panelSource, /aria-label="\$\{i18n\.openEditorTabs\}"/);
  assert.match(panelSource, /escapeCssString\(this\.localeStrings\.webviewStyleLoadFailed\)/);
  assert.match(panelSource, /JSON\.stringify\(this\.localeStrings\.webviewScriptLoadFailed\)/);
  assert.match(panelSource, /defaultManualGroupName\(source, target, this\.localeStrings\.newGroup\)/);
  assert.doesNotMatch(nativeMenuSource, /startsWith\('zh'\)/);
  assert.match(nativeMenuSource, /coreCommand\('workbench\.action\.splitEditor', strings\.nativeSplitEditor\)/);
});

test('extension registers an always-visible status bar toggle and refreshes it with relevant state', () => {
  const extensionSource = readFileSync(path.resolve(__dirname, '../../../src/extension.ts'), 'utf8');
  const statusBarSource = readFileSync(path.resolve(__dirname, '../../../src/statusbar/VerticalTabsStatusBar.ts'), 'utf8');

  assert.match(extensionSource, /const statusBar = new VerticalTabsStatusBar\(\)/);
  assert.match(extensionSource, /context\.subscriptions\.push\([\s\S]*statusBar,/);
  assert.match(statusBarSource, /createStatusBarItem\(/);
  assert.match(statusBarSource, /vscode\.StatusBarAlignment\.Right/);
  assert.match(statusBarSource, /this\.item\.command = 'verticalTabs\.toggle'/);
  assert.match(statusBarSource, /VerticalTabsPanel\.onDidChangeVisibility\(\(\) => this\.refresh\(\)\)/);
  assert.match(statusBarSource, /event\.affectsConfiguration\('verticalTabs\.position'\)/);
  assert.match(statusBarSource, /event\.affectsConfiguration\('verticalTabs\.language'\)/);
  assert.match(statusBarSource, /this\.item\.show\(\)/);
});

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
  assert.match(webviewSource, /function showContextMenu\([\s\S]+?tab\?: VerticalTabItem,[\s\S]+?group\?: VerticalTabDisplayGroup,[\s\S]+?invoker\?: HTMLElement/);
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
  assert.match(source, /showContextMenu\(event\.clientX, event\.clientY, undefined, group, header\)/);
 assert.match(source, /menu\.append\(renameGroupButton\(group\)\)/);
  assert.match(source, /const remove = iconButton\('close', i18n\.closeGroupAndDelete\)/);
  assert.match(source, /remove\.className = 'group-action tab-action group-close-action'/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'closeGroup', groupId: group\.id \}\)/);
  assert.match(source, /if \(group\.isManual && group\.id !== '__ungrouped'\)/);
  assert.match(source, /header\.draggable = true/);
  assert.match(source, /draggedGroupId = group\.id/);
  assert.match(panelSource, /message\.type === 'deleteGroup' \|\| message\.type === 'closeGroup'/);
  assert.match(panelSource, /vscode\.window\.tabGroups\.close\(sourceGroup, true\)/);
  assert.match(panelSource, /this\.manualGroups\.splice\(manualGroupIndex, 1\)/);
  assert.match(source, /const main = document\.createElement\('div'\)/);
  assert.match(source, /main\.className = 'group-main'/);
  assert.match(style, /\.group-actions, \.tab-actions \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-width: 0;[\s\S]*?padding-right: 0;[\s\S]*?\}/);
  assert.match(style, /\.group-actions \{ margin-right: 1px; \}/);
  assert.match(style, /\.group-close-action,[\s\S]*?\.tab-close-action \{ display: none; \}/);
  assert.match(style, /\.group-header:hover \.group-close-action,[\s\S]*?\.group-header:focus-within \.group-close-action,[\s\S]*?display: inline-flex;/);
});

test('tab context menus append an optional VS Code action group with secure opaque actions', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');
  const manifest = readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8');

  assert.match(webviewSource, /if \(tab && snapshot\?\.nativeContextMenuActionsEnabled\)/);
  assert.match(webviewSource, /type: 'requestNativeTabMenu', requestId, target: tab\.target, targets/);
  assert.match(webviewSource, /if \(!hasNativeMenuAction\(entries\)\) return;[\s\S]+pending\.menu\.append\([\s\S]+createNativeMenuSourceDivider\(i18n\.nativeMenuSourceWarning\),[\s\S]+\.\.\.nativeContextMenuElements/);
  assert.match(webviewSource, /divider\.setAttribute\('role', 'separator'\)/);
  assert.match(webviewSource, /divider\.setAttribute\('aria-label', label\)/);
  assert.match(webviewSource, /type: 'runNativeTabMenuAction', actionId: entry\.actionId, target, targets/);
  assert.match(webviewSource, /pending\.requestId !== requestId/);
  assert.match(webviewSource, /event\.key === 'ArrowRight'/);
  assert.match(webviewSource, /event\.key === 'ArrowLeft'/);
  assert.match(style, /\.tab-context-separator/);
  assert.match(style, /\.tab-context-source-divider \{[\s\S]+color: var\(--vscode-descriptionForeground\);[\s\S]+display: flex;/);
  assert.match(style, /\.tab-context-source-divider::before,[\s\S]+\.tab-context-source-divider::after \{[\s\S]+border-top:/);
  assert.match(panelSource, /nativeTabMenuProvider\.resolveAction\(actionId\)/);
  assert.match(panelSource, /action\.command === 'compareSelected'/);
  assert.match(panelSource, /'vscode\.diff',[\s\S]+originalInput\.uri,[\s\S]+modifiedInput\.uri/);
  assert.doesNotMatch(webviewSource, /executeCommand/);
  assert.match(manifest, /"verticalTabs\.showNativeContextMenuActions"[\s\S]+?"default": true[\s\S]+?"scope": "window"/);
  assert.match(manifest, /"verticalTabs\.compactContextSubmenus"[\s\S]+?"default": true[\s\S]+?"scope": "window"/);
  assert.match(panelSource, /compactContextSubmenusEnabled: readCompactContextSubmenusEnabled\(\)/);
  assert.match(webviewSource, /COMPACT_CONTEXT_SUBMENU_HOVER_DELAY_MS = 1000/);
  assert.match(webviewSource, /chooseContextSubmenuLayout/);
  assert.match(webviewSource, /wrapper\.addEventListener\('mouseenter', \(\) => openContextSubmenu\(trigger, submenu, false\)\)/);
  assert.match(webviewSource, /trigger\.addEventListener\('click', \(\) => openContextSubmenu\(trigger, submenu, true\)\)/);
  assert.match(webviewSource, /window\.setTimeout\([\s\S]+COMPACT_CONTEXT_SUBMENU_HOVER_DELAY_MS/);
  assert.match(webviewSource, /window\.clearTimeout\(contextSubmenuHoverTimer\)/);
  assert.match(webviewSource, /enterCompactContextSubmenu/);
  assert.match(webviewSource, /leaveCompactContextSubmenu/);
  assert.match(webviewSource, /button\(`‹ \$\{i18n\.back\}`/);
  assert.match(webviewSource, /if \(contextMenu\) dismissContextMenu\(\)/);
  assert.match(style, /\.tab-context-menu\.is-compact/);
  assert.match(style, /\.tab-context-submenu-list\.is-compact-panel/);
  assert.match(style, /overflow-wrap: anywhere/);
  assert.match(style, /max-height: calc\(100vh - 8px\)/);
  assert.doesNotMatch(style, /\.tab-context-submenu:hover \.tab-context-submenu-list/);
});

test('group names are centered and preserve their original capitalization', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /\.group-name \{[\s\S]*?text-align: center;[\s\S]*?\}/);
  assert.match(style, /\.group-name \{[\s\S]*?text-transform: none;[\s\S]*?\}/);
  assert.doesNotMatch(style, /\.group-name \{[\s\S]*?text-transform: uppercase;[\s\S]*?\}/);
});

test('group headers use theme-aware accent text and separators without background shading', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.doesNotMatch(style, /--vertical-tab-group-background-shade/);
  assert.match(style, /--vertical-tab-group-accent: var\(--vscode-textLink-foreground, var\(--vscode-focusBorder, #007fd4\)\);/);
  assert.match(style, /--vertical-tab-group-active-accent: var\(--vscode-textLink-activeForeground, var\(--vertical-tab-group-accent\)\);/);
  assert.match(style, /\.group-header \{[\s\S]*?background: transparent;[\s\S]*?border-bottom: 1px solid color-mix\(in srgb, var\(--vertical-tab-group-accent\) 45%, transparent\);/);
  assert.match(style, /\.group-header:hover \.group-toggle,[\s\S]*?\.group-header:hover \.group-name \{\s*color: var\(--vertical-tab-group-active-accent\);/);
  assert.match(style, /\.group-toggle \{ color: var\(--vertical-tab-group-accent\);/);
  assert.match(style, /\.group-name \{\s*color: var\(--vertical-tab-group-accent\);/);
  assert.match(style, /body\.vscode-high-contrast \.group-header,[\s\S]*?body\.vscode-high-contrast-light \.group-header \{\s*border-bottom-color: var\(--vscode-contrastBorder, var\(--vertical-tab-group-accent\)\);/);
  assert.match(style, /\.tab-group\.has-focused-tab > \.group-header \{\s*border-left: 2px solid var\(--vscode-focusBorder\);/);
});

test('tab close buttons reclaim their width until the row is hovered or keyboard-focused', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /result\.className = 'tab-action tab-close-action'/);
  assert.match(style, /\.group-actions, \.tab-actions \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-width: 0;[\s\S]*?padding-right: 0;[\s\S]*?\}/);
  assert.match(style, /\.tab-close-action \{ display: none; \}/);
  assert.match(style, /\.tab-row:hover \.tab-close-action,[\s\S]+\.tab-row:focus-within \.tab-close-action \{[\s\S]+display: inline-flex;/);
  assert.match(source, /actionButton\(i18n\.closeOthers, i18n\.closeOthers, 'closeOthers'/);
  assert.match(source, /actionButton\(i18n\.closeBelow, i18n\.closeBelow, 'closeBelow'/);
  assert.doesNotMatch(source, /关闭其它标签|关闭下侧标签/);
});

test('tab labels have no leading icon slot and pinned state renders on the right', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const messages = readFileSync(path.resolve(__dirname, '../../../src/webview/messages.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /activate\.append\(text\)/);
  assert.match(source, /\{ kind: 'pinned', icon: 'pinned', label: i18n\.pinnedTab \}/);
  assert.doesNotMatch(source, /createTabIcon|tab-pin-slot|activate\.append\(icon/);
  assert.doesNotMatch(messages, /TabVisualIcon|ProductIconName|readonly icon:/);
  assert.doesNotMatch(style, /\.tab-(?:icon|seti-icon|product-icon|pin-slot)/);
  assert.match(style, /\.tab-text \{[\s\S]+flex-direction: column;[\s\S]+min-width: 0;[\s\S]+?\}/);
});

test('group pin and close icons share the tab status and action coordinates', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /statuses\.className = 'tab-status-list group-status-list'/);
  assert.match(source, /pin\.classList\.add\('tab-status', 'group-pin-indicator'\)/);
  assert.match(source, /actions\.append\(statuses, remove\)/);
  assert.doesNotMatch(source, /main\.append\(pin\)/);
  assert.match(style, /\.group-actions, \.tab-actions \{[\s\S]*?flex: 0 0 auto;[\s\S]*?padding-right: 0;/);
  assert.match(style, /\.group-actions \{ margin-right: 1px; \}/);
  assert.doesNotMatch(style, /\.group-header \.tab-action \{/);
});

test('tab statuses render in a stable accessible list immediately before the close button', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.doesNotMatch(source, /tab\.isDirty \? '● ' : ''/);
  assert.match(source, /statuses\.className = 'tab-status-list'/);
  assert.match(source, /statusIcon\.classList\.add\('tab-status', `tab-status-\$\{status\.kind\}`\)/);
  assert.match(source, /statusIcon\.title = status\.label/);
  assert.match(source, /actions\.append\(statuses, closeSelectionButton\(tab\)\)/);
  assert.match(source, /tabAccessibleLabel\(tab\)[\s\S]+tabStatusLabels\(tab\)/);
  assert.match(source, /\{ kind: 'dirty', icon: 'circle-filled', label: i18n\.unsavedChanges \}/);
  const descriptors = source.match(/function tabStatusDescriptors[\s\S]+?return statuses;\s*}/)?.[0] ?? '';
  const orderedStates = [
    'tab.isPreview',
    'tab.isPinned',
    "tab.resourceStatus === 'readonly'",
    'tab.isDirty',
    "tab.resourceStatus === 'missing'",
    "tab.resourceStatus === 'noPermissions'",
    "tab.resourceStatus === 'unavailable'",
    '!tab.isActivatable',
  ];
  let lastIndex = -1;
  for (const state of orderedStates) {
    const index = descriptors.indexOf(state);
    assert.ok(index > lastIndex, `${state} should render after the preceding status`);
    lastIndex = index;
  }
  assert.match(style, /\.tab-status-list \{[\s\S]+gap: var\(--vertical-tab-status-gap\)/);
  assert.match(style, /\.tab-status \{[\s\S]+user-select: none;/);
  assert.doesNotMatch(style, /\.tab-status \{[^}]+pointer-events: none;/);
  assert.match(source, /function codicon[\s\S]+icon\.setAttribute\('aria-hidden', 'true'\)/);
});

test('compact tab spacing prioritizes label and path width without shrinking the close target', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /--vertical-tab-action-size: 22px;/);
  assert.match(style, /--vertical-tab-status-size: 14px;/);
  assert.match(style, /--vertical-tab-status-gap: 2px;/);
  assert.match(style, /--vertical-tab-inline-padding: 6px;/);
  assert.doesNotMatch(style, /vertical-tab-tree-indent|\.tab-row\.tree-level-1/);
  assert.match(style, /\.tab-main \{[\s\S]+padding: 2px 0 2px var\(--vertical-tab-inline-padding\);/);
  assert.match(style, /\.tab-label \{ flex: 1 1 auto; min-width: 0;[\s\S]+text-overflow: ellipsis;/);
  assert.match(style, /\.tab-action \{[\s\S]+height: var\(--vertical-tab-action-size\);[\s\S]+min-width: var\(--vertical-tab-action-size\);/);
});

test('pinned groups render an indicator, sort first, and reject unsupported host messages', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /const pin = codicon\('pinned'\)/);
  assert.match(source, /pin\.classList\.add\('tab-status', 'group-pin-indicator'\)/);
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

  assert.match(panelSource, /isFocused: tab\.isActive && \(tab\.group\.isActive \|\| tab\.group === this\.lastFocusedUserGroup\)/);
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
  assert.deepEqual(properties['verticalTabs.defaultSortMode']?.enum, ['none', 'mru', 'modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc']);
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

test('webview selection is synchronized for command-driven multi-tab moves', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const messages = readFileSync(path.resolve(__dirname, '../../../src/webview/messages.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /vscode\.postMessage\(\{ type: 'selectionChanged', targets \}\)/);
  assert.match(messages, /type: 'selectionChanged'; readonly targets: readonly TabTarget\[\]/);
  assert.match(panelSource, /private commandSelectedTargets: readonly TabTarget\[\] = \[\]/);
  assert.match(panelSource, /planDisplayedTabMove\(this\.currentSnapshot, anchorTarget, this\.commandSelectedTargets, direction\)/);
  assert.match(panelSource, /selectedDisplayedTabsInAnchorGroup\(/);
  assert.match(panelSource, /this\.setDisplayGroupOrder\(plan\.group\.id, plan\.desiredTabs\)/);
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
    /const instance = VerticalTabsPanel\.panels\.current \?\? await VerticalTabsPanel\.open\(context\);[\s\S]+await instance\?\.navigate\(direction, scope\)/,
  );
});

test('shortcut navigation previews immediately and commits only the latest target after an idle delay', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const messagesSource = readFileSync(path.resolve(__dirname, '../../../src/webview/messages.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');
  const navigateMethod = panelSource.match(/private async navigate\([\s\S]+?\n  \}\n\n  private async ensureShortcutNavigationSnapshot/)?.[0] ?? '';

  assert.match(panelSource, /const SHORTCUT_NAVIGATION_COMMIT_DELAY_MS = 160/);
  assert.match(navigateMethod, /this\.shortcutNavigationOrigin \?\?= anchor/);
  assert.match(navigateMethod, /this\.shortcutNavigation\.queue\(target\)/);
  assert.doesNotMatch(navigateMethod, /this\.refresh\(/);
  assert.match(panelSource, /private async commitShortcutNavigation\(target: TabTarget\)/);
  assert.match(panelSource, /await this\.activateTab\(tab\);\s*await this\.refresh\(\{ reason: 'navigate' \}\)/);
  assert.match(
    panelSource,
    /this\.shortcutNavigationActivationDepth === 0 && !this\.shortcutNavigationOriginRemainsActive\(\)/,
  );
  const guardedCancellationCount = panelSource.match(
    /this\.shortcutNavigationActivationDepth === 0 && !this\.shortcutNavigationOriginRemainsActive\(\)/g,
  )?.length ?? 0;
  assert.equal(guardedCancellationCount, 3);
  assert.match(
    panelSource,
    /private shortcutNavigationOriginRemainsActive\(\): boolean \{[\s\S]+tab\.group\.activeTab === tab/,
  );
  assert.match(messagesSource, /type: 'previewTabNavigation'/);
  assert.match(messagesSource, /type: 'clearTabNavigationPreview'/);
  assert.match(webviewSource, /previewKeyboardNavigation\(event\.data\.target\)/);
  assert.match(webviewSource, /row\.classList\.add\('is-keyboard-preview'\)/);
  assert.match(webviewSource, /row\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(style, /\.tab-row\.is-keyboard-preview/);
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
  assert.match(panelSource, /<option value="mru">\$\{i18n\.sortModeMru\}<\/option>/);
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

test('workset toolbar action synchronizes collapse state and delegates management to the extension host', () => {
  const mainSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const extensionSource = readFileSync(path.resolve(__dirname, '../../../src/extension.ts'), 'utf8');
  assert.match(panelSource, /id="worksets"/);
  assert.match(extensionSource, /verticalTabs\.saveWorkset/);
  assert.match(extensionSource, /verticalTabs\.loadWorkset/);
  assert.match(mainSource, /type: 'manageWorksets'/);
  assert.match(mainSource, /type: 'setCollapsedGroups', keys/);
  assert.match(mainSource, /collapsedGroupKeys: Array\.from\(collapsedGroups\)/);
});

test('MRU sorting tracks verified activations across editor groups without rewriting native tab order', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(panelSource, /private readonly mruTracker = new TabMruTracker<vscode\.Tab>\(\)/);
  assert.match(panelSource, /const activeGroup = vscode\.window\.tabGroups\.all\.find\(\(group\) => group\.isActive\)/);
  assert.match(panelSource, /this\.mruTracker\.observeFocused\(focusedUserTab\)/);
  assert.match(panelSource, /lastActivatedAt: this\.mruTracker\.lastActivatedAt\(tab\)/);
  assert.match(panelSource, /if \(matched\) \{[\s\S]+this\.mruTracker\.recordSuccessfulActivation\(tab\)/);
  assert.match(panelSource, /this\.suppressMruTracking = true;[\s\S]+await this\.syncVsCodeGroupOrder[\s\S]+this\.suppressMruTracking = false/);
  assert.match(panelSource, /if \(this\.sortMode === 'mru'\) \{[\s\S]+最近使用排序不回写 VS Code 原生标签顺序/);
});

test('webview renders status Codicons and a compact icon-free two-line label layout', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(source, /const result = iconButton\('close', i18n\.closeTab\)/);
  assert.match(source, /\{ kind: 'pinned', icon: 'pinned', label: i18n\.pinnedTab \}/);
  assert.match(source, /tab\.isPreview \? 'is-preview' : ''/);
  assert.match(source, /activate\.append\(text\)/);
  assert.match(source, /activate\.setAttribute\('aria-label', tabAccessibleLabel\(tab\)\)/);
  assert.match(source, /icon\.setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(source, /button\('×'|textContent = '📌'|button\(collapsed \? '▶' : '▼'/);
  assert.match(panelSource, /codicon-search/);
  assert.match(panelSource, /codicon-settings-gear/);
  assert.doesNotMatch(source, /Seti|createTabIcon|tab-icon/);
  assert.doesNotMatch(panelSource, /Seti|seti/);
  assert.doesNotMatch(style, /tab-seti-icon|tab-product-icon|tab-icon/);
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

test('manual mode context menu moves single or selected tabs to manual groups and the root', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');

  assert.match(source, /function appendManualGroupActions/);
  assert.match(source, /snapshot\.groupMode === 'manual'/);
  assert.match(source, /tabs\.every\(\(tab\) => tab\.manualGroupId === group\.id\)/);
  assert.match(source, /tabs\.every\(\(tab\) => tab\.manualGroupId === undefined\)/);
  assert.match(source, /type: 'moveTabs', targets/);
  assert.match(source, /selectedTabsFor\(tab\)/);
});

test('vscode mode context menu moves selected tabs to an existing visible editor group', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(source, /messageButton\('移至新组'/);
  assert.match(source, /function appendVsCodeGroupActions/);
  assert.match(source, /snapshot\.groupMode === 'vscode'/);
  assert.match(source, /group\.mode !== 'vscode'/);
  assert.match(source, /tabs\.every\(\(tab\) => tab\.target\.groupIndex === destinationGroupIndex\)/);
  assert.match(source, /moveTabsToGroupButton/);
  assert.doesNotMatch(source, /messageButton\('移至上一组'/);
  assert.doesNotMatch(source, /messageButton\('移至下一组'/);
  assert.match(panelSource, /if \(message\.type === 'moveTabs'\)/);
  assert.match(panelSource, /this\.resolveVsCodeDisplayGroup\(groupId\)/);
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
  assert.match(panelSource, /await this\.activateTab\(tab, message\.requestId, focus\);\s*await this\.refresh\(\{ reason: 'navigate' \}\);/);
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

test('host and webview reject stale snapshots from overlapping refreshes', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(panelSource, /private readonly refreshGate = new LatestRefreshGate\(\)/);
  assert.match(panelSource, /const requestId = this\.refreshGate\.begin\(\)/);
  assert.match(panelSource, /return this\.awaitLatestRefresh\(operation\)/);
  assert.match(panelSource, /if \(!this\.refreshGate\.isCurrent\(requestId\)\)[\s\S]+丢弃已被更新请求取代的标签快照/);
  assert.match(webviewSource, /shouldAcceptSnapshotRevision\(latestSnapshot\?\.revision, event\.data\.snapshot\.revision\)/);
  assert.match(webviewSource, /忽略乱序到达的旧标签快照/);
});

test('extension resource metadata lookup has a timeout without treating timeout as an error state', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /INPUT_METADATA_TIMEOUT_MS = 250/);
  assert.match(source, /withTimeout\(vscode\.workspace\.fs\.stat\(uri\), INPUT_METADATA_TIMEOUT_MS\)/);
  assert.match(source, /errorCode = fileSystemErrorCode\(error\)/);
  assert.match(source, /classifyTabResourceStatus\(\{[\s\S]+errorCode,/);
});

test('extension deduplicates resource metadata, uses the modified diff side, and refreshes watched resources', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /const resourceMetadataCache = new Map<string, Promise<TabResourceMetadata>>/);
  assert.match(source, /resolveCachedResourceMetadata\(cache, key, \(\) => this\.readResourceMetadata\(uri\)\)/);
  assert.match(source, /input instanceof vscode\.TabInputTextDiff \|\| input instanceof vscode\.TabInputNotebookDiff[\s\S]+input\.modified/);
  assert.match(source, /vscode\.workspace\.fs\.isWritableFileSystem\(uri\.scheme\)/);
  assert.match(source, /stat\.permissions & vscode\.FilePermission\.Readonly/);
  assert.match(source, /new vscode\.RelativePattern\(wanted\.parent, '\*'\)/);
  assert.match(source, /watcher\.onDidCreate\(shouldRefresh\)/);
  assert.match(source, /watcher\.onDidChange\(shouldRefresh\)/);
  assert.match(source, /watcher\.onDidDelete\(shouldRefresh\)/);
  assert.match(source, /event\.affectsConfiguration\('files\.readonlyInclude'\)/);
  assert.match(source, /event\.affectsConfiguration\('files\.readonlyExclude'\)/);
  assert.match(source, /event\.affectsConfiguration\('files\.readonlyFromPermissions'\)/);
});

test('extension registers the webview message listener before setting html and keeps an initial host refresh fallback', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.match(source, /onDidReceiveMessage[\s\S]+this\.configureWebview\(\)/);
  assert.match(source, /INITIAL_HOST_REFRESH_DELAY_MS = 800/);
  assert.match(source, /reason: 'hostInitialFallback', ensureEmptyLayout: false/);
  assert.match(source, /SNAPSHOT_REFRESH_TIMEOUT_MS = 2000/);
  assert.match(source, /刷新垂直标签快照失败，将发送上一份可用快照避免 Webview 停留在加载态/);
  assert.match(source, /private async toSnapshotTabSafe\([\s\S]+resourceMetadataCache: Map<string, Promise<TabResourceMetadata>>/);
});

test('extension restores the prepared rail layout without a fixed visible delay', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');

  assert.doesNotMatch(source, /RAIL_SETTLE_DELAY_MS/);
  assert.match(source, /const initialGroupIndex = await this\.waitForOwnGroup\(\)/);
  assert.match(source, /const preparedRailGroup = await prepareRailGroup\(context, position\)[\s\S]+vscode\.window\.createWebviewPanel/);
  assert.match(source, /const layoutAppliedBeforePanel = canApplyBeforePanel[\s\S]+applyRailRatio\(ratio, position, creationLayout\)/);
  assert.match(source, /preparedEditorLayout: creationLayout,[\s\S]+layoutAppliedBeforePanel/);
  assert.match(source, /if \(!preparedRailGroup\.layoutAppliedBeforePanel\)[\s\S]+setTimeout\(resolve, GROUP_WAIT_INTERVAL_MS\)[\s\S]+applyRailRatio\(preparedRailGroup\.ratio, this\.railPosition, preparedRailGroup\.preparedEditorLayout\)/);
  assert.match(source, /宽度已在 Webview 显示前应用，跳过显示后的布局等待和重复写入/);
});

test('rail creation avoids activating a narrow edge editor before restoring widths', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const prepareStart = source.indexOf('async function prepareRailGroup(');
  const prepareEnd = source.indexOf('function getConfiguredRailRatio(', prepareStart);
  const prepareSource = source.slice(prepareStart, prepareEnd);

  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart);
  assert.match(
    prepareSource,
    /await prepareNarrowEdgeEditorGroupBeforeRailCreation\(previousLayout, position\)[\s\S]+await vscode\.commands\.executeCommand\(createCommand\)/,
  );
  assert.match(prepareSource, /selectWidestEditorGroupViewColumn\(/);
  assert.match(prepareSource, /moveActiveEmptyGroupToRailEdge\(position\)/);
  assert.match(prepareSource, /mode: 'pixel', delta: 3[\s\S]+mode: 'ratio'/);
  assert.match(prepareSource, /previousWidth !== VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH[\s\S]+ready: true/);
  assert.match(
    prepareSource,
    /if \(creationLayoutPreparation && !creationLayoutPreparation\.ready\)[\s\S]+return undefined;[\s\S]+executeCommand\(createCommand\)/,
  );
  assert.match(
    prepareSource,
    /applyEditorLayoutUntilStable\(nextLayout,[\s\S]+width: requestedWidth,[\s\S]+mode: 'minimum'/,
  );
  assert.match(prepareSource, /layoutCommandApplied[\s\S]+applyEditorLayoutUntilStable\(layout\)[\s\S]+ready: false/);
  assert.doesNotMatch(prepareSource, /workbench\.action\.focusFirstEditorGroup/);
  assert.doesNotMatch(prepareSource, /workbench\.action\.focusLastEditorGroup/);
});

test('rail minimum-width correction verifies the rail without minimizing a user donor', () => {
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const layoutSource = readFileSync(path.resolve(__dirname, '../../../src/layout/RailLayout.ts'), 'utf8');

  assert.match(
    panelSource,
    /correctMinimizedEditorGroupWidth\(layout, viewColumn\)[\s\S]+applyEditorLayoutUntilStable\(nextLayout, \{[\s\S]+viewColumn,[\s\S]+width: SAFE_RAIL_WIDTH,[\s\S]+mode: 'minimum'/,
  );
  assert.match(panelSource, /verifiedWidth === undefined \|\| verifiedWidth < SAFE_RAIL_WIDTH/);
  assert.match(layoutSource, /availableWidth = Math\.max\(0, Math\.floor\(size - safeWidth\)\)/);
  assert.match(layoutSource, /contributionByIndex[\s\S]+remainingWidth/);
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
    /if \(previousLayout && countLayoutLeaves\(layout\) === countLayoutLeaves\(previousLayout\) \+ 1\)[\s\S]+if \(preservedLayout\)[\s\S]+applyEditorLayoutUntilStable\(preservedLayout, protectedWidth\)[\s\S]+return true;\s*}\s*const existingRailLikeGroup/,
  );
});

test('extension returns rail width to its original editor donors when hidden', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const closeStart = source.indexOf('private async close(): Promise<void>');
  const closeEnd = source.indexOf('private async focusAndLockOwnGroup()', closeStart);
  const closeSource = source.slice(closeStart, closeEnd);

  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  assert.match(
    source,
    /await this\.captureCloseLayoutRestore\([\s\S]+preparedRailGroup\?\.preparedEditorLayout \?\? preparedRailGroup\?\.previousLayout/,
  );
  assert.match(source, /Math\.abs\(totalContribution - railWidth\) <= CLOSE_LAYOUT_RESTORE_TOLERANCE_PX/);
  assert.match(source, /editorLayoutAfterShow: EditorLayout/);
  assert.match(
    closeSource,
    /prepareMinimizedEditorBesideRailBeforeHide\(initialLayout, this\.railPosition\)[\s\S]+removeRailRestoringEditorWidths\(currentLayout, this\.railPosition, contributions\)[\s\S]+tabGroups\.close\(group, true\)/,
  );
  assert.match(closeSource, /if \(adjacentPreparation && !adjacentPreparation\.ready\)[\s\S]+hideCancelled = true;[\s\S]+return;/);
  assert.match(
    closeSource,
    /if \(hideCancelled\) \{[\s\S]+return;[\s\S]+this\.panel\.dispose\(\)/,
  );
  assert.match(source, /removeRailRestoringEditorWidths\(currentLayout, this\.railPosition, contributions\)/);
  assert.match(source, /HIDE_MINIMIZED_EDITOR_TARGET_WIDTH = SAFE_MINIMIZED_EDITOR_GROUP_WIDTH/);
  assert.match(
    source,
    /widenMinimizedEditorBesideRailBeforeHide\([\s\S]+HIDE_MINIMIZED_EDITOR_TARGET_WIDTH[\s\S]+applyEditorLayoutUntilStable\(nextLayout, \{[\s\S]+mode: 'exact'/,
  );
  assert.match(
    closeSource,
    /removeRailPreservingCurrentEditorWidths\(initialLayout, this\.railPosition\)[\s\S]+editorLayoutsMatch\([\s\S]+this\.closeLayoutRestore\.editorLayoutAfterShow,[\s\S]+CLOSE_LAYOUT_RESTORE_TOLERANCE_PX/,
  );
  assert.match(closeSource, /restoreSnapshotMatches[\s\S]+\? \(this\.closeLayoutRestore\?\.contributions \?\? \[\]\)[\s\S]+: \[\]/);
  assert.match(closeSource, /normalizeMinimizedEdgeEditorGroupWidth\(restoredLayout, this\.railPosition\)/);
  assert.match(
    closeSource,
    /const finalRestoredLayout = minimizedEdgeNeedsNormalization[\s\S]+normalizedRestoredLayout[\s\S]+: restoredLayout/,
  );
  assert.match(closeSource, /else if \(minimizedEdgeNeedsNormalization\)[\s\S]+保留 VS Code 关闭分组后的原生布局/);
  assert.match(
    closeSource,
    /vscode\.window\.tabGroups\.close\(group, true\)[\s\S]+waitForEditorLayoutLeafCount\(countLayoutLeaves\(finalRestoredLayout\)\)[\s\S]+applyEditorLayoutUntilStable\([\s\S]+mode: 'exact'/,
  );
  assert.match(source, /LAYOUT_TRANSACTION_MAX_APPLY_ATTEMPTS = 3/);
  assert.match(source, /LAYOUT_STABILITY_SAMPLES = 3/);
  assert.match(source, /LAYOUT_STABILITY_INTERVAL_MS = 50/);
  assert.match(
    source,
    /stableSamples < LAYOUT_STABILITY_SAMPLES[\s\S]+editorLayoutsMatch\(lastObservedLayout, layout\)[\s\S]+hasProtectedEditorGroupWidth/,
  );
});

test('final Hide flow removes high-frequency diagnostic snapshots', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const closeStart = source.indexOf('private async close(): Promise<void>');
  const closeEnd = source.indexOf('private async focusAndLockOwnGroup()', closeStart);
  const closeSource = source.slice(closeStart, closeEnd);

  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  assert.doesNotMatch(source, /Hide 布局诊断快照/);
  assert.doesNotMatch(source, /hideLayoutDiagnosticSequence/);
  assert.doesNotMatch(source, /for \(const delayMs of \[50, 150, 300\]\)/);
  assert.match(closeSource, /logDebug\('准备隐藏垂直标签栏并恢复用户编辑器组宽度'/);
  assert.match(closeSource, /contributionHistoryDiscarded/);
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
  assert.match(source, /已内联读取 Webview 样式与 Codicon 字体/);
  assert.match(source, /读取 Webview 样式失败，将使用最小降级样式/);
  assert.match(source, /escapeCssString\(this\.localeStrings\.webviewStyleLoadFailed\)/);
  assert.match(source, /font-src \$\{this\.panel\.webview\.cspSource\}/);
  assert.match(source, new RegExp(String.raw`style-src 'nonce-\$\{nonce\}'; script-src 'nonce-\$\{nonce\}'`));
  assert.match(source, new RegExp(String.raw`<style nonce="\$\{nonce\}">\$\{styleContent\}<\/style>`));
  assert.doesNotMatch(source, /<link rel="stylesheet"/);
  assert.doesNotMatch(source, /style-src \$\{cspSource\}/);
  assert.match(source, /node_modules\/@vscode\/codicons|out', 'codicon\.css'/);
  assert.match(source, /out', 'codicon\.ttf'/);
  assert.doesNotMatch(source, /setiFontPath|theme-seti|setiRoot/);
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

  assert.match(source, /activate\.setAttribute\('aria-disabled', String\(!tab\.isActivatable\)\)/);
  assert.match(source, /if \(!tab\.isActivatable\) return/);
  assert.match(source, /function activationTitle\(tab: VerticalTabItem\): string/);
  assert.match(source, /tab\.activationKind === 'bestEffort'/);
  assert.match(source, /i18n\.bestEffortActivation/);
  assert.match(source, /i18n\.unsupportedActivation/);
});

test('tab tree uses one roving tab stop and supports keyboard navigation and context menus', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(panelSource, /id="groups" role="tree" tabindex="0"/);
  assert.match(source, /header\.className = 'group-header tree-navigation-item'/);
  assert.match(source, /activate\.className = 'tab-main tree-navigation-item'/);
  assert.match(source, /header\.tabIndex = -1/);
  assert.match(source, /activate\.tabIndex = -1/);
  assert.match(source, /function initializeTreeFocus/);
  assert.match(source, /for \(const item of items\) item\.tabIndex = -1/);
  assert.match(source, /if \(target\) target\.tabIndex = 0/);
  assert.match(source, /groups\?\.addEventListener\('keydown', handleTreeKeyDown\)/);
  assert.match(source, /event\.key === 'Enter' && item\.classList\.contains\('tab-main'\)/);
  assert.match(source, /openKeyboardContextMenu\(event, header, undefined, group\)/);
  assert.match(source, /openKeyboardContextMenu\(event, activate, tab\)/);
  assert.match(source, /isKeyboardContextMenuKey\(event\.key, event\.shiftKey\)/);
  assert.match(source, /menu\.addEventListener\('keydown', handleContextMenuKeyDown\)/);
  assert.match(source, /nextVerticalNavigationIndex\(currentIndex, actions\.length, event\.key, true\)/);
  assert.match(source, /dismissContextMenu\(true\)/);
  assert.match(source, /invoker\.focus\(\{ preventScroll: true \}\)/);
  assert.match(style, /\.tab-context-action:focus-visible/);
});

test('tab tree previews adjacent files without surrendering focus and Enter commits editor focus', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const messagesSource = readFileSync(path.resolve(__dirname, '../../../src/webview/messages.ts'), 'utf8');

  assert.match(source, /new DeferredTargetCommitter<TabTarget>\(160/);
  assert.match(source, /focusTreeItem\(nextItem\);\s*queueKeyboardNavigationActivation\(nextItem\);/);
  assert.match(source, /vscode\.postMessage\(\{ type: 'activateTab', target, requestId, focus: 'rail' \}\)/);
  assert.match(source, /cancelKeyboardNavigationActivation\(\);\s*item\.click\(\);/);
  assert.match(source, /event\.key === ' ' && item\.classList\.contains\('tab-main'\)/);
  assert.match(source, /window\.addEventListener\('blur'[\s\S]+?document\.activeElement\.blur\(\)/);
  assert.match(source, /event\.data\.type === 'focusTabList'/);
  assert.match(source, /function applyPendingTreeFocusRequest/);
  assert.match(source, /\.tab-row\.is-focused \.tab-main/);
  assert.match(panelSource, /type: 'focusTabList'/);
  assert.match(panelSource, /preserveFocus: focus === 'rail'/);
  assert.match(panelSource, /activeTabMatches\(target, tab, focus === 'editor'\)/);
  assert.match(messagesSource, /export type TabActivationFocus = 'editor' \| 'rail'/);
});

test('focus shortcut activates the extension and forwards focus into the rendered tab tree', () => {
  const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
    readonly activationEvents: readonly string[];
    readonly contributes: { readonly keybindings: ReadonlyArray<{ readonly command: string; readonly key: string; readonly mac?: string }> };
  };
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const source = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const messagesSource = readFileSync(path.resolve(__dirname, '../../../src/webview/messages.ts'), 'utf8');

  assert.ok(packageJson.activationEvents.includes('onCommand:verticalTabs.focus'));
  assert.ok(packageJson.contributes.keybindings.some((binding) => (
    binding.command === 'verticalTabs.focus'
    && binding.key === 'ctrl+alt+v'
    && binding.mac === 'cmd+alt+v'
  )));
  assert.match(panelSource, /static async focus[\s\S]+?await instance\?\.reveal\(false\);[\s\S]+?instance\?\.postMessage\(\{ type: 'focusTabList' \}\);/);
  assert.match(panelSource, /if \(!this\.panel\.active\) \{\s*this\.postMessage\(\{ type: 'blurTabList' \}\);/);
  assert.match(source, /event\.data\.type === 'blurTabList'/);
  assert.match(source, /document\.activeElement\.blur\(\)/);
  assert.match(messagesSource, /\{ readonly type: 'focusTabList' \}[\s\S]+?\{ readonly type: 'blurTabList' \}/);
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

test('draggable tabs and group headers keep the regular clickable cursor', () => {
  const style = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(style, /\.group-header \{[\s\S]*?cursor: pointer;[\s\S]*?\}/);
  assert.match(style, /\.tab-row \{[\s\S]*?cursor: pointer;[\s\S]*?\}/);
  assert.doesNotMatch(style, /cursor:\s*grab(?:bing)?/);
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
  assert.match(source, /function activeTabMatches\(target: TabPosition, tab: vscode\.Tab, requireGroupFocus = true\): boolean/);
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
  assert.match(source, /for \(const tab of event\.closed\)[\s\S]+?this\.clearClosedTabState\(targetIdentity\(tab\)\)/);
  assert.match(source, /const openedGroupId = undefined/);
  assert.match(source, /for \(const tab of event\.opened\)[\s\S]+?this\.setManualGroup\(identity, openedGroupId\)/);
  assert.match(source, /this\.removeManualDisplayOrderKey\(key\)/);
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
  assert.match(source, /private async activateTab\(\s*tab: vscode\.Tab,\s*requestId\?: string,\s*focus: TabActivationFocus = 'editor',\s*\): Promise<void>/);
  assert.match(source, /private async selectExistingTab\(tab: vscode\.Tab, requestId\?: string\): Promise<boolean>/);
  assert.match(source, /private logActivationOutcome\(\s*tab: vscode\.Tab,\s*method: string,\s*requestId\?: string,\s*focus: TabActivationFocus = 'editor',\s*\): void/);
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
  assert.match(source, /showWarningMessage\([\s\S]+\{ modal: true, detail \}[\s\S]+this\.localeStrings\.overwrite/);
  assert.match(source, /await vscode\.window\.tabGroups\.close\(destinationTabs, true\)/);
  assert.match(source, /workspace\.fs\.rename\(sourceUri, destinationUri, \{ overwrite: destinationExists \}\)/);
  assert.match(source, /await this\.openMovedResource\(sourceInput, tab\.label, destinationUri, replacementViewColumn\)/);
  assert.match(source, /const duplicateTabs = replacementTab \? openedDestinationTabs\.filter/);
  assert.match(source, /const staleSourceTabs = findTabsByResourceUri\(sourceUri\)/);
});


test('search uses one control row with an opt-in workspace-relative path mode', () => {
  const webviewSource = readFileSync(path.resolve(__dirname, '../../../src/webview/main.ts'), 'utf8');
  const panelSource = readFileSync(path.resolve(__dirname, '../../../src/webview/VerticalTabsPanel.ts'), 'utf8');
  const styleSource = readFileSync(path.resolve(__dirname, '../../../media/vertical-tabs.css'), 'utf8');

  assert.match(panelSource, /id="toggle-search"/);
  assert.match(panelSource, /id="search-container"/);
  assert.match(panelSource, /id="search-input"/);
  assert.match(panelSource, /id="search-group-toggle"/);
  assert.match(panelSource, /id="regex-search-toggle"/);
  assert.match(panelSource, /id="search-workspace-relative-path-toggle"[\s\S]*aria-pressed="false"[\s\S]*codicon-root-folder/);
  assert.doesNotMatch(panelSource, /id="filter-(?:unsaved|pinned|current-group|file-type)"/);
  assert.doesNotMatch(panelSource, /class="search-filters"/);
  assert.match(panelSource, /id="search-result-count"/);
  assert.match(panelSource, /id="search-error"/);
  assert.ok(webviewSource.includes("querySelector<HTMLInputElement>('#search-input')"));
  assert.ok(webviewSource.includes("querySelector<HTMLButtonElement>('#search-group-toggle')"));
  assert.ok(webviewSource.includes("querySelector<HTMLButtonElement>('#regex-search-toggle')"));
  assert.ok(webviewSource.includes("querySelector<HTMLButtonElement>('#search-workspace-relative-path-toggle')"));
  assert.ok(webviewSource.includes("querySelector<HTMLButtonElement>('#toggle-search')"));
  assert.ok(webviewSource.includes("querySelector<HTMLElement>('#search-container')"));
  assert.ok(webviewSource.includes("type: 'setSearchVisible'"));
  assert.ok(webviewSource.includes("type: 'setSearchGroups'"));
  assert.match(webviewSource, /let currentSearchWorkspaceRelativePaths = false/);
  assert.match(webviewSource, /searchWorkspaceRelativePaths: currentSearchWorkspaceRelativePaths/);
  assert.match(webviewSource, /evaluateTabSearch/);
  assert.match(webviewSource, /appendHighlightedText/);
  assert.match(webviewSource, /searchCollapsedGroups/);
  assert.match(webviewSource, /event\.key !== 'Escape'/);
  assert.match(webviewSource, /function clearSearch/);
  assert.match(webviewSource, /function applyCurrentFilter/);
  assert.match(webviewSource, /function setSearchContainerVisible/);
  assert.match(panelSource, /lastFocusedUserGroup/);
  assert.match(panelSource, /updateLastFocusedUserGroup/);
  assert.match(styleSource, /\.search-match/);
  assert.match(styleSource, /\.search-error/);
  assert.doesNotMatch(styleSource, /\.search-filters/);
  assert.doesNotMatch(styleSource, /\.search-filter-toggle/);
  assert.match(panelSource, /searchVisible:/);
  assert.match(panelSource, /searchGroups:/);
  assert.match(panelSource, /SEARCH_VISIBLE_STORAGE_KEY/);
  assert.match(panelSource, /SEARCH_GROUPS_STORAGE_KEY/);
});
