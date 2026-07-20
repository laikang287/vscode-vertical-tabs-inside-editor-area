import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { buildSnapshot, selectCloseTargets, type SnapshotSourceGroup, type SnapshotSourceTab, type TabInputKind } from '../tabs/TabSnapshot';
import { SingletonPanel } from './SingletonPanel';
import { type ExtensionMessage, type TabTarget, type VerticalTabsSnapshot, parseWebviewMessage } from './messages';

export const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';

export class VerticalTabsPanel {
  private static readonly panels = new SingletonPanel<VerticalTabsPanel>();
  private static serializerRegistered = false;

  private readonly disposables: vscode.Disposable[] = [];
  private revision = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private currentSnapshot: VerticalTabsSnapshot = { revision: 0, groups: [] };

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.configureWebview();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message)),
      vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleRefresh()),
    );
  }

  static initialize(context: vscode.ExtensionContext): void {
    if (!VerticalTabsPanel.serializerRegistered) {
      context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel: async (panel) => {
          VerticalTabsPanel.attach(panel, context.extensionUri);
          await VerticalTabsPanel.panels.current?.ensureRail();
        },
      }));
      VerticalTabsPanel.serializerRegistered = true;
    }

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => VerticalTabsPanel.panels.current?.scheduleRefresh()),
    );
    VerticalTabsPanel.ensure(context.extensionUri);
  }

  static ensure(extensionUri: vscode.Uri): VerticalTabsPanel {
    return VerticalTabsPanel.panels.show(
      () => {
        const panel = vscode.window.createWebviewPanel(
          VIEW_TYPE,
          TITLE,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), vscode.Uri.joinPath(extensionUri, 'media')],
            retainContextWhenHidden: true,
          },
        );
        const result = new VerticalTabsPanel(panel, extensionUri);
        void result.ensureRail();
        return result;
      },
      (existingPanel) => existingPanel.reveal(true),
    );
  }

  static focus(extensionUri: vscode.Uri): void {
    VerticalTabsPanel.ensure(extensionUri).reveal(false);
  }

  static dispose(): void {
    VerticalTabsPanel.panels.current?.close();
  }

  static navigate(extensionUri: vscode.Uri, direction: 1 | -1): void {
    const instance = VerticalTabsPanel.ensure(extensionUri);
    void instance.navigate(direction);
  }

  private static attach(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    const existing = VerticalTabsPanel.panels.current;
    if (existing) {
      existing.close();
    }
    VerticalTabsPanel.panels.show(
      () => new VerticalTabsPanel(panel, extensionUri),
      () => undefined,
    );
  }

  private async ensureRail(): Promise<void> {
    const previousEditor = vscode.window.activeTextEditor;
    let ownGroupIndex = await this.waitForOwnGroup();
    if (ownGroupIndex < 0) {
      return;
    }
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, false);

    const ownGroup = vscode.window.tabGroups.all[ownGroupIndex];
    if (ownGroup.tabs.length > 1) {
      await vscode.commands.executeCommand('workbench.action.newGroupLeft');
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, false);
      await vscode.commands.executeCommand('workbench.action.moveEditorToLeftGroup');
      ownGroupIndex = await this.waitForOwnGroup();
      if (ownGroupIndex < 0) {
        return;
      }
    }

    for (let moves = 0, index = ownGroupIndex; index > 0 && moves < vscode.window.tabGroups.all.length; moves += 1, index = this.findOwnGroupIndex()) {
      await vscode.commands.executeCommand('workbench.action.moveActiveEditorGroupLeft');
    }

    if (this.findOwnGroupIndex() !== 0) {
      return;
    }
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    if (previousEditor) {
      await vscode.window.showTextDocument(previousEditor.document, {
        viewColumn: previousEditor.viewColumn,
        preserveFocus: false,
        selection: previousEditor.selection,
      });
    }
    this.refresh();
  }

  private findOwnGroupIndex(): number {
    return vscode.window.tabGroups.all.findIndex((group) => group.tabs.some((tab) => isVerticalTabsPanel(tab)));
  }

  private async waitForOwnGroup(): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const index = this.findOwnGroupIndex();
      if (index >= 0) {
        return index;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return -1;
  }

  private dispose(): void {
    VerticalTabsPanel.panels.clear(this);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private reveal(preserveFocus: boolean): void {
    this.panel.reveal(this.panel.viewColumn, preserveFocus);
  }

  private close(): void {
    this.panel.dispose();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 0);
  }

  private refresh(): void {
    this.currentSnapshot = this.createSnapshot();
    this.postMessage({ type: 'renderTabs', title: TITLE, snapshot: this.currentSnapshot });
  }

  private createSnapshot(): VerticalTabsSnapshot {
    this.revision += 1;
    const groups: SnapshotSourceGroup[] = vscode.window.tabGroups.all.map((group) => ({
      isActive: group.isActive,
      viewColumn: group.viewColumn,
      tabs: group.tabs.map((tab) => this.toSnapshotTab(tab)),
    }));
    return buildSnapshot(groups, this.revision);
  }

  private toSnapshotTab(tab: vscode.Tab): SnapshotSourceTab {
    return {
      label: tab.label,
      isActive: tab.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      inputKind: inputKind(tab.input),
      path: inputPath(tab.input),
      isVerticalTabsPanel: isVerticalTabsPanel(tab),
    };
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseWebviewMessage(value);
    if (!message) {
      return;
    }

    if (message.type === 'ready' || message.type === 'requestRefresh') {
      this.refresh();
      return;
    }

    if (message.type === 'activateTab') {
      const tab = this.resolveTab(message.target);
      if (tab) {
        await this.activateTab(tab);
      }
      return;
    }

    const action = message.type === 'closeTab'
      ? 'close'
      : message.type === 'closeOthers'
        ? 'closeOthers'
        : message.type === 'closeBelow'
          ? 'closeBelow'
          : 'closeSaved';
    const targets = selectCloseTargets(this.currentSnapshot, action, 'target' in message ? message.target : undefined);
    const tabs = targets.map((target) => this.resolveTab(target)).filter((tab): tab is vscode.Tab => tab !== undefined);
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs, true);
    }
    this.refresh();
  }

  private resolveTab(target: TabTarget): vscode.Tab | undefined {
    if (target.revision !== this.currentSnapshot.revision) {
      return undefined;
    }
    const tab = vscode.window.tabGroups.all[target.groupIndex]?.tabs[target.tabIndex];
    return tab && !isVerticalTabsPanel(tab) ? tab : undefined;
  }

  private async navigate(direction: 1 | -1): Promise<void> {
    this.refresh();
    const tabs = this.currentSnapshot.groups.flatMap((group) => group.tabs).filter((tab) => tab.isActivatable);
    if (tabs.length === 0) {
      return;
    }
    const activeIndex = tabs.findIndex((tab) => tab.isActive && this.currentSnapshot.groups
      .some((group) => group.isActive && group.tabs.some((candidate) => candidate.target === tab.target)));
    const index = activeIndex < 0 ? 0 : (activeIndex + direction + tabs.length) % tabs.length;
    const tab = this.resolveTab(tabs[index].target);
    if (tab) {
      await this.activateTab(tab);
    }
  }

  private async activateTab(tab: vscode.Tab): Promise<void> {
    const options: vscode.TextDocumentShowOptions = { viewColumn: tab.group.viewColumn, preserveFocus: false };
    if (tab.input instanceof vscode.TabInputText) {
      await vscode.window.showTextDocument(tab.input.uri, options);
      return;
    }
    if (tab.input instanceof vscode.TabInputTextDiff || tab.input instanceof vscode.TabInputNotebookDiff) {
      await vscode.commands.executeCommand('vscode.diff', tab.input.original, tab.input.modified, tab.label, options);
      return;
    }
    if (tab.input instanceof vscode.TabInputCustom) {
      await vscode.commands.executeCommand('vscode.openWith', tab.input.uri, tab.input.viewType, options);
      return;
    }
    if (tab.input instanceof vscode.TabInputNotebook) {
      await vscode.commands.executeCommand('vscode.openWith', tab.input.uri, tab.input.notebookType, options);
    }
  }

  private postMessage(message: ExtensionMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private configureWebview(): void {
    this.panel.webview.html = this.createHtml();
  }

  private createHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'vertical-tabs.css'));
    const nonce = crypto.randomBytes(16).toString('base64');
    const cspSource = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>${TITLE}</title>
</head>
<body>
  <main class="vertical-tabs" aria-live="polite">
    <header class="toolbar"><h1>${TITLE}</h1><button id="close-saved" type="button" title="关闭已保存的标签">清理</button></header>
    <p id="description">正在同步打开的标签…</p>
    <section id="groups" aria-label="打开的编辑器标签"></section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function isVerticalTabsPanel(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputWebview && tab.input.viewType === VIEW_TYPE;
}

function inputKind(input: vscode.Tab['input']): TabInputKind {
  if (input instanceof vscode.TabInputText) return 'text';
  if (input instanceof vscode.TabInputTextDiff) return 'diff';
  if (input instanceof vscode.TabInputCustom) return 'custom';
  if (input instanceof vscode.TabInputNotebook) return 'notebook';
  if (input instanceof vscode.TabInputNotebookDiff) return 'notebookDiff';
  if (input instanceof vscode.TabInputWebview) return 'webview';
  if (input instanceof vscode.TabInputTerminal) return 'terminal';
  return 'unknown';
}

function inputPath(input: vscode.Tab['input']): string | undefined {
  const uri = input instanceof vscode.TabInputText
    || input instanceof vscode.TabInputCustom
    || input instanceof vscode.TabInputNotebook
    ? input.uri
    : input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff
      ? input.modified
      : undefined;
  if (!uri) {
    return undefined;
  }
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative === uri.fsPath ? uri.path : relative;
}
