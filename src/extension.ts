import * as vscode from 'vscode';
import { initializeLogging, logDebug, logError, logInfo, showLogs } from './logging/extensionLogger';
import { VerticalTabsStatusBar } from './statusbar/VerticalTabsStatusBar';
import type { TabListFocusSource } from './tabs/TabListFocusTarget';
import { VerticalTabsPanel } from './webview/VerticalTabsPanel';

export function activate(context: vscode.ExtensionContext): void {
  initializeLogging(context);
  logInfo('扩展开始激活', { extensionId: context.extension.id, version: context.extension.packageJSON.version });

  const openCommand = registerLoggedCommand('verticalTabs.open', async () => {
    await VerticalTabsPanel.open(context);
  });
  const toggleCommand = registerLoggedCommand('verticalTabs.toggle', async () => {
    if (VerticalTabsPanel.isOpen()) {
      await VerticalTabsPanel.close();
    } else {
      await VerticalTabsPanel.open(context);
    }
  });
  const closeCommand = registerLoggedCommand('verticalTabs.close', () => VerticalTabsPanel.close());

  const focusCommand = registerLoggedCommand('verticalTabs.focus', (argument) => (
    VerticalTabsPanel.focus(context, tabListFocusSourceFromCommandArgument(argument))
  ));
  const previousCommand = registerLoggedCommand('verticalTabs.previous', () => VerticalTabsPanel.navigate(context, -1, 'all'));
  const nextCommand = registerLoggedCommand('verticalTabs.next', () => VerticalTabsPanel.navigate(context, 1, 'all'));
  const previousInGroupCommand = registerLoggedCommand('verticalTabs.previousInGroup', () => VerticalTabsPanel.navigate(context, -1, 'group'));
  const nextInGroupCommand = registerLoggedCommand('verticalTabs.nextInGroup', () => VerticalTabsPanel.navigate(context, 1, 'group'));
  const previousAcrossGroupsCommand = registerLoggedCommand('verticalTabs.previousAcrossGroups', () => VerticalTabsPanel.navigate(context, -1, 'all'));
  const nextAcrossGroupsCommand = registerLoggedCommand('verticalTabs.nextAcrossGroups', () => VerticalTabsPanel.navigate(context, 1, 'all'));
  const moveUpInGroupCommand = registerLoggedCommand('verticalTabs.moveUpInGroup', () => VerticalTabsPanel.moveTab(context, -1, 'tab'));
  const moveDownInGroupCommand = registerLoggedCommand('verticalTabs.moveDownInGroup', () => VerticalTabsPanel.moveTab(context, 1, 'tab'));
  const moveToPreviousGroupCommand = registerLoggedCommand('verticalTabs.moveToPreviousGroup', () => VerticalTabsPanel.moveTab(context, -1, 'group'));
  const moveToNextGroupCommand = registerLoggedCommand('verticalTabs.moveToNextGroup', () => VerticalTabsPanel.moveTab(context, 1, 'group'));
  const saveWorksetCommand = registerLoggedCommand('verticalTabs.saveWorkset', () => VerticalTabsPanel.saveWorkset(context));
  const loadWorksetCommand = registerLoggedCommand('verticalTabs.loadWorkset', () => VerticalTabsPanel.loadWorkset(context));
  const manageWorksetsCommand = registerLoggedCommand('verticalTabs.manageWorksets', () => VerticalTabsPanel.manageWorksets(context));
  const showLogsCommand = registerLoggedCommand('verticalTabs.showLogs', async () => showLogs());
  const launcherProvider = new EmptyLauncherProvider();
  const launcher = vscode.window.registerTreeDataProvider('verticalTabs.launcher', launcherProvider);
  const launcherVisibility = VerticalTabsPanel.onDidChangeVisibility(() => launcherProvider.refresh());
  const statusBar = new VerticalTabsStatusBar();

  context.subscriptions.push(
    openCommand,
    toggleCommand,
    closeCommand,
    focusCommand,
    previousCommand,
    nextCommand,
    previousInGroupCommand,
    nextInGroupCommand,
    previousAcrossGroupsCommand,
    nextAcrossGroupsCommand,
    moveUpInGroupCommand,
    moveDownInGroupCommand,
    moveToPreviousGroupCommand,
    moveToNextGroupCommand,
    saveWorksetCommand,
    loadWorksetCommand,
    manageWorksetsCommand,
    showLogsCommand,
    launcher,
    launcherVisibility,
    launcherProvider,
    statusBar,
  );
  VerticalTabsPanel.initialize(context);
  logInfo('扩展激活完成');
}

export function deactivate(): void {
  logInfo('扩展开始停用');
  VerticalTabsPanel.dispose();
}

function registerLoggedCommand(command: string, action: (...args: unknown[]) => Promise<void>): vscode.Disposable {
  return vscode.commands.registerCommand(command, async (...args: unknown[]) => {
    logDebug('执行命令', { command });
    try {
      await action(...args);
      logDebug('命令执行完成', { command });
    } catch (error) {
      logError('命令执行失败', { command, error });
      throw error;
    }
  });
}

function tabListFocusSourceFromCommandArgument(value: unknown): TabListFocusSource {
  if (typeof value === 'object' && value !== null && 'source' in value && value.source === 'editor') {
    return 'editor';
  }
  return 'outside';
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
