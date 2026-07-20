import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

suite('Vertical Tabs extension', () => {
  test('activates and exposes P0 commands', async () => {
    const extension = vscode.extensions.getExtension('local.vertical-tabs-in-editor-area');
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
        configuration: { properties: Record<string, { default: number }> };
        viewsContainers: { activitybar: Array<{ id: string }> };
      };
    };
    assert.ok(manifest.activationEvents.includes('onStartupFinished'));
    assert.ok(manifest.activationEvents.includes('onWebviewPanel:verticalTabs.editorArea'));
    assert.equal(manifest.contributes.configuration.properties['verticalTabs.defaultRailWidthRatio'].default, 0.2);
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

function rootGroupRatios(layout: EditorLayout): number[] {
  const sizes = layout.groups.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && size > 0)) {
    return [];
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return sizes.map((size) => size / total);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for the editor state to settle.');
}

async function waitForEditorLayout(predicate: (layout: EditorLayout) => boolean): Promise<EditorLayout> {
  let latest: EditorLayout | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => !isVerticalTabsTab(tab));
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
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
