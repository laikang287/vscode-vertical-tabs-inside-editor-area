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

    await vscode.commands.executeCommand('verticalTabs.open');
    await vscode.commands.executeCommand('verticalTabs.open');
    await waitFor(() => verticalTabs().length === 1);
    await waitFor(() => verticalTabs()[0]?.group.tabs.length === 1);

    const [{ group }] = verticalTabs();
    assert.equal(vscode.window.tabGroups.all[0], group, 'The vertical-tabs group should be the left-most group.');
    assert.equal(group.tabs.length, 1, 'The vertical-tabs panel should have an exclusive editor group.');

    const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const railRatio = leadingGroupRatio(layout);
    assert.ok(typeof railRatio === 'number' && Math.abs(railRatio - 0.2) < 0.01, `The rail should use 20% of the editor area on first open; received ${railRatio} from ${JSON.stringify(layout)}.`);

    await vscode.commands.executeCommand('verticalTabs.focus');
    const document = await vscode.workspace.openTextDocument({ content: 'locked rail verification' });
    await vscode.window.showTextDocument(document, { preserveFocus: false });
    assert.ok(!group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString()), 'A normal editor must not open in the locked rail group.');

    await vscode.commands.executeCommand('verticalTabs.close');
    await waitFor(() => verticalTabs().length === 0);
    await vscode.commands.executeCommand('verticalTabs.toggle');
    await waitFor(() => verticalTabs().length === 1);
    assert.equal(vscode.window.tabGroups.all[0], verticalTabs()[0].group, 'Reopening from the launcher should put the rail back on the far left.');
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

function leadingGroupRatio(layout: EditorLayout): number | undefined {
  const sizes = layout.groups.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && size > 0)) {
    return undefined;
  }
  return sizes[0] / sizes.reduce((sum, size) => sum + size, 0);
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
