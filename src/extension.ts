import * as vscode from 'vscode';
import { initializeLogging, logDebug, logError, logInfo, showLogs } from './logging/extensionLogger';
import { VerticalTabsPanel } from './webview/VerticalTabsPanel';

export function activate(context: vscode.ExtensionContext): void {
  initializeLogging(context);
  logInfo('扩展开始激活', { extensionId: context.extension.id, version: context.extension.packageJSON.version });

  const openCommand = registerLoggedCommand('verticalTabs.open', () => VerticalTabsPanel.focus(context));
  const toggleCommand = registerLoggedCommand('verticalTabs.toggle', async () => {
    if (VerticalTabsPanel.isOpen()) {
      await VerticalTabsPanel.close();
    } else {
      await VerticalTabsPanel.focus(context);
    }
  });
  const closeCommand = registerLoggedCommand('verticalTabs.close', () => VerticalTabsPanel.close());

  const focusCommand = registerLoggedCommand('verticalTabs.focus', () => VerticalTabsPanel.focus(context));
  const previousCommand = registerLoggedCommand('verticalTabs.previous', () => VerticalTabsPanel.navigate(context, -1));
  const nextCommand = registerLoggedCommand('verticalTabs.next', () => VerticalTabsPanel.navigate(context, 1));
  const showLogsCommand = registerLoggedCommand('verticalTabs.showLogs', async () => showLogs());
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
    showLogsCommand,
    launcher,
    launcherVisibility,
    launcherProvider,
  );
  VerticalTabsPanel.initialize(context);
  logInfo('扩展激活完成');
}

export function deactivate(): void {
  logInfo('扩展开始停用');
  VerticalTabsPanel.dispose();
}

function registerLoggedCommand(command: string, action: () => Promise<void>): vscode.Disposable {
  return vscode.commands.registerCommand(command, async () => {
    logDebug('执行命令', { command });
    try {
      await action();
      logDebug('命令执行完成', { command });
    } catch (error) {
      logError('命令执行失败', { command, error });
      throw error;
    }
  });
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
