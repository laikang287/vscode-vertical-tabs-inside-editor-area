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
    await waitFor(() => placeholders().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.tabs.length === 1);

    const [{ group }] = verticalTabs();
    const [{ tab: placeholder, group: placeholderGroup }] = placeholders();
    assert.equal(group.viewColumn, vscode.ViewColumn.One, 'The vertical-tabs group should be the left-most group.');
    assert.equal(group.tabs.length, 1, 'The vertical-tabs panel should have an exclusive editor group.');
    assert.notEqual(placeholderGroup, group, 'The placeholder should be in a non-rail editor group.');
    assert.ok(placeholder.isPinned, 'The placeholder should be pinned so its editor group is retained.');
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
    await waitFor(() => placeholders().length === 1);
    assert.equal(verticalTabs()[0]?.group.tabs.length, 1, 'Closing the final normal tab must not add an editor to the rail group.');
    const layoutAfterClosingNormalTab = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const preservedRailRatios = rootGroupRatios(layoutAfterClosingNormalTab);
    assert.ok(preservedRailRatios.some((ratio) => ratio >= 0.2 && ratio < 0.3), `The rail width should remain stable after normal tabs close; received ${JSON.stringify(layoutAfterClosingNormalTab)}.`);

    await vscode.window.tabGroups.close(placeholder, true);
    await waitFor(() => placeholders().length === 1
      && placeholders()[0].tab !== placeholder
      && placeholders()[0].tab.isPinned);

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

function placeholders(): Array<{ tab: vscode.Tab; group: vscode.TabGroup }> {
  const result: Array<{ tab: vscode.Tab; group: vscode.TabGroup }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && (tab.input.viewType === 'verticalTabs.editorAreaPlaceholder'
        || tab.input.viewType === 'mainThreadWebview-verticalTabs.editorAreaPlaceholder')) {
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
