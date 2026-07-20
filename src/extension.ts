import * as vscode from 'vscode';
import { VerticalTabsPanel } from './webview/VerticalTabsPanel';

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand('verticalTabs.open', () => {
    VerticalTabsPanel.focus(context.extensionUri);
  });

  const focusCommand = vscode.commands.registerCommand('verticalTabs.focus', () => {
    VerticalTabsPanel.focus(context.extensionUri);
  });
  const previousCommand = vscode.commands.registerCommand('verticalTabs.previous', () => {
    VerticalTabsPanel.navigate(context.extensionUri, -1);
  });
  const nextCommand = vscode.commands.registerCommand('verticalTabs.next', () => {
    VerticalTabsPanel.navigate(context.extensionUri, 1);
  });

  context.subscriptions.push(openCommand, focusCommand, previousCommand, nextCommand);
  VerticalTabsPanel.initialize(context);
}

export function deactivate(): void {
  VerticalTabsPanel.dispose();
}
