import * as vscode from 'vscode';
import { VerticalTabsPanel } from './webview/VerticalTabsPanel';

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand('verticalTabs.open', () => {
    VerticalTabsPanel.show(context.extensionUri);
  });

  context.subscriptions.push(openCommand);
  VerticalTabsPanel.show(context.extensionUri);
}

export function deactivate(): void {
  VerticalTabsPanel.dispose();
}
