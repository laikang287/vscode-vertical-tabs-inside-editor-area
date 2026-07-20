import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Vertical Tabs extension', () => {
  test('activates and registers the open command', async () => {
    const extension = vscode.extensions.getExtension('local.vertical-tabs-in-editor-area');
    assert.ok(extension, 'The extension should be discoverable.');

    await extension.activate();
    assert.ok(extension.isActive, 'The extension should activate.');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('verticalTabs.open'), 'The open command should be registered.');

    await vscode.commands.executeCommand('verticalTabs.open');
  });
});
