import * as vscode from 'vscode';
import { VerticalTabsPanel } from './webview/VerticalTabsPanel';

export function activate(context: vscode.ExtensionContext): void {
  const openCommand = vscode.commands.registerCommand('verticalTabs.open', () => VerticalTabsPanel.focus(context));
  const toggleCommand = vscode.commands.registerCommand('verticalTabs.toggle', async () => {
    if (VerticalTabsPanel.isOpen()) {
      await VerticalTabsPanel.close();
    } else {
      await VerticalTabsPanel.focus(context);
    }
  });
  const closeCommand = vscode.commands.registerCommand('verticalTabs.close', () => VerticalTabsPanel.close());

  const focusCommand = vscode.commands.registerCommand('verticalTabs.focus', () => VerticalTabsPanel.focus(context));
  const previousCommand = vscode.commands.registerCommand('verticalTabs.previous', () => VerticalTabsPanel.navigate(context, -1));
  const nextCommand = vscode.commands.registerCommand('verticalTabs.next', () => VerticalTabsPanel.navigate(context, 1));
  const launcherProvider = new EmptyLauncherProvider();
  const launcher = vscode.window.registerTreeDataProvider('verticalTabs.launcher', launcherProvider);
  const launcherVisibility = VerticalTabsPanel.onDidChangeVisibility(() => launcherProvider.refresh());

  context.subscriptions.push(
    openCommand,
    toggleCommand,
    closeCommand,
    focusCommand,
    previousCommand,
    nextCommand,
    launcher,
    launcherVisibility,
    launcherProvider,
  );
  VerticalTabsPanel.initialize(context);
}

export function deactivate(): void {
  VerticalTabsPanel.dispose();
}

class EmptyLauncherProvider implements vscode.TreeDataProvider<never>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  getTreeItem(): vscode.TreeItem {
    throw new Error('垂直标签页启动器不包含树项目。');
  }

  getChildren(): never[] {
    return [];
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
