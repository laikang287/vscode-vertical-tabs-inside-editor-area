import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

suite('Vertical Tabs extension', () => {
  test('activates and exposes P0 commands', async () => {
    const extension = vscode.extensions.getExtension('laikang287.vertical-tabs-inside-editor-area');
    assert.ok(extension, 'The extension should be discoverable.');

    await extension.activate();
    assert.ok(extension.isActive, 'The extension should activate.');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('verticalTabs.open'), 'The open command should be registered.');
    assert.ok(commands.includes('verticalTabs.toggle'), 'The toggle command should be registered.');
    assert.ok(commands.includes('verticalTabs.close'), 'The close command should be registered.');
    assert.ok(commands.includes('verticalTabs.focus'), 'The focus command should be registered.');
    assert.ok(commands.includes('verticalTabs.previous'), 'The previous command should be registered.');
    assert.ok(commands.includes('verticalTabs.next'), 'The next command should be registered.');
    assert.ok(commands.includes('verticalTabs.showLogs'), 'The show logs command should be registered.');

  });

  test('keeps one locked vertical-tabs group on the left and restores its width', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);

    const existingDocument = await vscode.workspace.openTextDocument({ content: 'editor already open before rail creation' });
    await vscode.window.showTextDocument(existingDocument, { preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.open');
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.tabs.length === 1);

    const [{ group }] = verticalTabs();
    assert.equal(group.viewColumn, vscode.ViewColumn.One, 'The vertical-tabs group should be the left-most group.');
    assert.equal(group.tabs.length, 1, 'The vertical-tabs panel should have an exclusive editor group.');
    assert.ok(vscode.window.tabGroups.all.filter((editorGroup) => editorGroup !== group).some((editorGroup) => editorGroup.tabs.some((tab) => (
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === existingDocument.uri.toString()
    ))), 'An editor already open before rail creation should remain outside the new left rail group.');

    const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const railRatios = rootGroupRatios(layout);
    assert.ok(railRatios.some((ratio) => ratio >= 0.2 && ratio < 0.3), `The rail should use the configured 20% width unless VS Code enforces its native minimum group width; received ${JSON.stringify(layout)}.`);

    const existingTab = vscode.window.tabGroups.all.flatMap((editorGroup) => editorGroup.tabs).find((tab) => (
      tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === existingDocument.uri.toString()
    ));
    assert.ok(existingTab, 'The pre-existing editor tab should remain available for cleanup.');
    await vscode.window.tabGroups.close(existingTab, true);
    await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length >= 2);
    const emptyRailLayout = await waitForEditorLayout((candidate) => rootGroupRatios(candidate).some((ratio) => ratio >= 0.2 && ratio < 0.3));
    const emptyRailRatios = rootGroupRatios(emptyRailLayout);
    assert.ok(emptyRailRatios.some((ratio) => ratio >= 0.2 && ratio < 0.3), `The rail should restore its configured width after the last right-side tab closes; received ${JSON.stringify(emptyRailLayout)}.`);
    assert.ok(nonVerticalTabs().some(({ tab }) => isBuiltInEditorTab(tab, 'welcome')), 'Closing the last right-side tab should still restore a usable welcome editor area.');

    await vscode.commands.executeCommand('verticalTabs.focus');
    const document = await vscode.workspace.openTextDocument({ content: 'locked rail verification' });
    await vscode.window.showTextDocument(document, { preserveFocus: false });
    assert.ok(!group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()), 'A normal editor must not open in the locked rail group.');

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await vscode.commands.executeCommand('verticalTabs.toggle');
    await waitFor(() => verticalTabs().length === 1);
    assert.equal(verticalTabs()[0].group.viewColumn, vscode.ViewColumn.One, 'Reopening from the launcher should put the rail back on the far left.');
  });

  test('declares the startup and webview restoration activation events', () => {
    const manifestPath = path.resolve(__dirname, '../../../../package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      activationEvents: string[];
      contributes: {
        configuration: { properties: Record<string, { default: unknown; markdownDescription?: string }> };
        viewsContainers: { activitybar: Array<{ id: string }> };
      };
    };
    assert.ok(manifest.activationEvents.includes('onStartupFinished'));
    assert.ok(manifest.activationEvents.includes('onWebviewPanel:verticalTabs.editorArea'));
    assert.ok(!('verticalTabs.defaultRailWidthRatio' in manifest.contributes.configuration.properties));
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.rememberState'].default, true);
   assert.equal(manifest.contributes.configuration.properties['verticalTabs.tabWidthRatio'].default, 0.2);
    assert.match(manifest.contributes.configuration.properties['verticalTabs.tabWidthRatio'].markdownDescription ?? '', /%verticalTabs\.config\.tabWidthRatio%/);
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.defaultGroupMode'].default, 'vscode');
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.defaultSortMode'].default, 'none');
    assert.ok(manifest.contributes.viewsContainers.activitybar.some((view: { id: string }) => view.id === 'vertical-tabs-activitybar'));
  });

  test('activates existing built-in webview tabs without duplicating them', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);

    await verifyBuiltInWebviewNavigation('settings');
    await verifyBuiltInWebviewNavigation('welcome');

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
  });

  test('rapid empty-state open requests restore one welcome editor area', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();
    await waitFor(() => vscode.window.tabGroups.all.every((group) => group.tabs.length === 0 || group.tabs.every((tab) => isVerticalTabsTab(tab))));

    await Promise.all([
      vscode.commands.executeCommand('verticalTabs.open'),
      vscode.commands.executeCommand('verticalTabs.focus'),
      vscode.commands.executeCommand('verticalTabs.open'),
      vscode.commands.executeCommand('verticalTabs.open'),
    ]);

    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.tabs.length === 1);
    await waitFor(() => nonVerticalTabs().length > 0);

    const rails = verticalTabs();
    assert.equal(rails.length, 1, 'Only one vertical-tabs panel should exist after rapid empty-state opens.');
    assert.equal(rails[0]?.group.viewColumn, vscode.ViewColumn.One, 'The vertical-tabs panel should be in the left-most group.');
    assert.equal(rails[0]?.group.tabs.length, 1, 'The rail group should contain only the vertical-tabs panel.');
    assert.equal(vscode.window.tabGroups.all.filter((group) => group.tabs.length === 0).length, 0, 'Rapid empty-state opens should not leave extra empty editor groups.');
    assert.ok(nonVerticalTabs().some(({ tab }) => isBuiltInEditorTab(tab, 'welcome')), 'The restored right editor area should contain the welcome editor.');
  });

  test('nudges the native minimum rail width before focus and restores it on reopen', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();

    const document = await vscode.workspace.openTextDocument({ content: 'minimum rail width persistence' });
    await vscode.window.showTextDocument(document, { preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.viewColumn === vscode.ViewColumn.One && verticalTabs()[0]?.group.tabs.length === 1);
    await waitFor(() => nonVerticalTabs().some(({ tab }) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()));

    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 180 }, { size: 1420 }] });
    const safeMinimumLayout = await waitForEditorLayout((candidate) => candidate.groups[0]?.size === 222);
    assert.equal(safeMinimumLayout.groups[0]?.size, 222, `The extension should nudge the rail above VS Code's native 220px minimum; received ${JSON.stringify(safeMinimumLayout)}.`);

    await vscode.commands.executeCommand('verticalTabs.focus');
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const focusedLayout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    assert.equal(focusedLayout.groups[0]?.size, 222, `Focusing the rail must not expand it to the maximum width; received ${JSON.stringify(focusedLayout)}.`);

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);

    const reopenedLayout = await waitForEditorLayout((candidate) => {
      const ratios = rootGroupRatios(candidate);
      return ratios.length >= 2 && (candidate.groups[0]?.size ?? 0) > 220 && (ratios[0] ?? 1) <= 0.3;
    });
    const reopenedRatios = rootGroupRatios(reopenedLayout);
    assert.ok((reopenedRatios[0] ?? 1) <= 0.3, `The rail should restore its safe narrow ratio rather than expanding; received ${JSON.stringify(reopenedLayout)}.`);
  });

  test('corrects only the vertical-tabs group after a third editor group expands', async function () {
    this.timeout(15_000);
    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await closeNonVerticalTabs();

    const secondDocument = await vscode.workspace.openTextDocument({ content: 'second editor group' });
    await vscode.window.showTextDocument(secondDocument, { preserveFocus: false });
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1 && vscode.window.tabGroups.all.length >= 2);
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('workbench.action.newGroupRight');
    const thirdDocument = await vscode.workspace.openTextDocument({ content: 'third editor group' });
    await vscode.window.showTextDocument(thirdDocument, { preserveFocus: false });
    await waitFor(() => vscode.window.tabGroups.all.length === 3);

    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 0,
      groups: [{ size: 300 }, { size: 1080 }, { size: 220 }],
    });
    await waitForEditorLayout((candidate) => candidate.groups[2]?.size === 220);

    await vscode.commands.executeCommand('workbench.action.focusThirdEditorGroup');
    const expandedLayout = await waitForEditorLayout((candidate) => (
      candidate.groups[0]?.size === 222
      && candidate.groups[1]?.size === 220
      && (candidate.groups[2]?.size ?? 0) > 220
    ));
    const expandedSizes = expandedLayout.groups.map((group) => group.size);
    assert.ok(expandedSizes.every((size): size is number => typeof size === 'number'));
    const expandedTotal = expandedSizes.reduce((total, size) => total + size, 0);
    assert.deepEqual(
      expandedSizes,
      [222, 220, expandedTotal - 442],
      `Only the vertical-tabs group should be nudged after the third group expands; received ${JSON.stringify(expandedLayout)}.`,
    );
  });
});

interface EditorLayoutGroup {
  readonly size?: number;
  readonly groups?: readonly EditorLayoutGroup[];
}

interface EditorLayout {
  readonly groups: readonly EditorLayoutGroup[];
}

function verticalTabs(): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && (tab.input.viewType === 'verticalTabs.editorArea'
        || tab.input.viewType === 'mainThreadWebview-verticalTabs.editorArea')) {
        result.push({ tab, group });
      }
    }
  }
  return result;
}

function nonVerticalTabs(): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!isVerticalTabsTab(tab)) {
        result.push({ tab, group });
      }
    }
  }
  return result;
}

function rootGroupRatios(layout: EditorLayout): number[] {
  const sizes = layout.groups.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && size > 0)) {
    return [];
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => size / total);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for the editor state to settle.');
}

async function waitForEditorLayout(predicate: (layout: EditorLayout) => boolean): Promise<EditorLayout> {
  let latest: EditorLayout | undefined;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    latest = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    if (predicate(latest)) {
      return latest;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for the editor layout to settle. Latest layout: ${JSON.stringify(latest)}.`);
}

async function verifyBuiltInWebviewNavigation(kind: 'settings' | 'welcome'): Promise<void> {
  await closeNonVerticalTabs();
  await waitFor(() => vscode.window.tabGroups.all.every((group) => group.tabs.every((tab) => isVerticalTabsTab(tab))));
  const document = await vscode.workspace.openTextDocument({ content: `navigation before ${kind}` });
  await vscode.window.showTextDocument(document, { preserveFocus: false });
  if (kind === 'settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings');
  } else {
    await openWelcomeForTest();
  }
  await waitFor(() => matchingBuiltInWebviewTabs(kind).length > 0);
  const before = matchingBuiltInWebviewTabs(kind).length;

  await vscode.window.showTextDocument(document, { preserveFocus: false });
  await waitFor(() => activeTextDocumentUri() === document.uri.toString());
  await vscode.commands.executeCommand('verticalTabs.open');
  await waitFor(() => verticalTabs().length === 1);
  await vscode.window.showTextDocument(document, { preserveFocus: false });
  await waitFor(() => activeTextDocumentUri() === document.uri.toString());

  await vscode.commands.executeCommand('verticalTabs.next');
  await waitFor(() => matchingBuiltInWebviewTabs(kind).some(({ tab, group }) => group.isActive && group.activeTab === tab));
  assert.equal(matchingBuiltInWebviewTabs(kind).length, before, `${kind} navigation should not create a duplicate tab.`);
  await closeNonVerticalTabs();
}

function matchingBuiltInWebviewTabs(kind: 'settings' | 'welcome'): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (isBuiltInEditorTab(tab, kind)) {
        result.push({ tab, group });
      }
    }
  }
  return result;
}

function isBuiltInEditorTab(tab: vscode.Tab, kind: 'settings' | 'welcome'): boolean {
  const viewType = tab.input instanceof vscode.TabInputWebview ? tab.input.viewType.toLowerCase() : '';
  const label = tab.label.toLowerCase();
  if (kind === 'settings') {
    return viewType.includes('settings') || viewType.includes('preferences') || label.includes('settings') || label === '设置';
  }
  return viewType.includes('welcome') || viewType.includes('gettingstarted') || label.includes('welcome') || label.includes('getting started') || label === '欢迎';
}

function activeTextDocumentUri(): string | undefined {
  const active = vscode.window.tabGroups.activeTabGroup.activeTab;
  return active?.input instanceof vscode.TabInputText ? active.input.uri.toString() : undefined;
}

async function closeNonVerticalTabs(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => !isVerticalTabsTab(tab));
    if (tabs.length === 0) {
      return;
    }
    await vscode.window.tabGroups.close(tabs, true);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function isVerticalTabsTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputWebview && (tab.input.viewType === 'verticalTabs.editorArea'
    || tab.input.viewType === 'mainThreadWebview-verticalTabs.editorArea');
}

async function openWelcomeForTest(): Promise<void> {
  const attempts: Array<readonly [string, ...unknown[]]> = [
    ['workbench.action.openWelcome'],
    ['workbench.action.openWalkthrough', 'gettingStarted', false],
    ['workbench.action.openWalkthrough', { category: 'gettingStarted' }, false],
  ];
  let latestError: unknown;
  for (const [command, ...args] of attempts) {
    try {
      await vscode.commands.executeCommand(command, ...args);
      return;
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError;
}
