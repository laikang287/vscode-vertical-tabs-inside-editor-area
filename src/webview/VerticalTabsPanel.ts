import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { countLayoutLeaves, isEditorLayout, normalizeRailWidth, prependRailToLayout, setLeadingRailWidth, type EditorLayout } from '../layout/RailLayout';
import { buildSnapshot, selectCloseTargets, type SnapshotSourceGroup, type SnapshotSourceTab, type TabInputKind } from '../tabs/TabSnapshot';
import { SingletonPanel } from './SingletonPanel';
import { type ExtensionMessage, type ManualTabGroup, type TabTarget, type VerticalTabsSnapshot, parseWebviewMessage } from './messages';

export const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';
const WIDTH_STORAGE_KEY = 'verticalTabs.railWidthPx';

export class VerticalTabsPanel {
  private static readonly panels = new SingletonPanel<VerticalTabsPanel>();
  private static serializerRegistered = false;
  private static operations: Promise<void> = Promise.resolve();

  private readonly disposables: vscode.Disposable[] = [];
  private revision = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private arrangingRail = false;
  private currentSnapshot: VerticalTabsSnapshot = { revision: 0, tabs: [], manualGroups: [] };
  private readonly manualGroups: ManualTabGroup[] = [];
  private readonly manualGroupByTab = new WeakMap<vscode.Tab, string>();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.configureWebview();
    VerticalTabsPanel.syncVisibilityContext();
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
          const instance = VerticalTabsPanel.attach(panel, context);
          await VerticalTabsPanel.enqueue(() => instance.ensureRail());
        },
      }));
      VerticalTabsPanel.serializerRegistered = true;
    }

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => VerticalTabsPanel.panels.current?.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabs(() => VerticalTabsPanel.syncVisibilityContext()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => VerticalTabsPanel.syncVisibilityContext()),
    );
    VerticalTabsPanel.syncVisibilityContext();
    void VerticalTabsPanel.open(context).catch(() => undefined);
  }

  static open(context: vscode.ExtensionContext): Promise<VerticalTabsPanel | undefined> {
    return VerticalTabsPanel.enqueue(() => VerticalTabsPanel.openCore(context));
  }

  private static async openCore(context: vscode.ExtensionContext): Promise<VerticalTabsPanel | undefined> {
    const existing = VerticalTabsPanel.panels.current;
    if (existing) {
      const previousEditor = vscode.window.activeTextEditor;
      existing.reveal(false);
      await existing.ensureRail(undefined, previousEditor);
      return existing;
    }

    // A restored webview tab can be visible before VS Code invokes its serializer.
    // Wait for the serializer instead of creating a duplicate panel beside it.
    if (hasVerticalTabsPanel()) {
      const restored = await VerticalTabsPanel.waitForAttachedPanel();
      VerticalTabsPanel.syncVisibilityContext();
      if (restored) {
        const previousEditor = vscode.window.activeTextEditor;
        restored.reveal(false);
        await restored.ensureRail(undefined, previousEditor);
      }
      return restored;
    }

    return VerticalTabsPanel.create(context);
  }

  static isOpen(): boolean {
    return hasVerticalTabsPanel();
  }

  static async focus(context: vscode.ExtensionContext): Promise<void> {
    const instance = await VerticalTabsPanel.open(context);
    instance?.reveal(false);
  }

  static async close(): Promise<void> {
    await VerticalTabsPanel.enqueue(async () => {
      const instance = VerticalTabsPanel.panels.current;
      if (instance) {
        await instance.close();
      } else {
        const tab = findVerticalTabsTab();
        if (tab) {
          await vscode.window.tabGroups.close(tab, true);
        }
      }
      VerticalTabsPanel.syncVisibilityContext();
    });
  }

  static dispose(): void {
    VerticalTabsPanel.panels.current?.panel.dispose();
  }

  static async navigate(context: vscode.ExtensionContext, direction: 1 | -1): Promise<void> {
    const instance = await VerticalTabsPanel.open(context);
    await instance?.navigate(direction);
  }

  private static async create(context: vscode.ExtensionContext): Promise<VerticalTabsPanel> {
    if (!hasUserTabs()) {
      await openWelcomePage();
    }
    const layoutBeforeRail = await getEditorLayout();
    const previouslyActiveEditor = vscode.window.activeTextEditor;
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out'), vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      },
    );
    const instance = VerticalTabsPanel.panels.show(
      () => new VerticalTabsPanel(panel, context),
      (existing) => existing.reveal(false),
    );
    await instance.ensureRail(layoutBeforeRail, previouslyActiveEditor);
    return instance;
  }

  private static attach(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): VerticalTabsPanel {
    const existing = VerticalTabsPanel.panels.current;
    if (existing) {
      panel.dispose();
      return existing;
    }
    return VerticalTabsPanel.panels.show(
      () => new VerticalTabsPanel(panel, context),
      () => undefined,
    );
  }

  private static enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = VerticalTabsPanel.operations.then(operation, operation);
    VerticalTabsPanel.operations = result.then(() => undefined, () => undefined);
    return result;
  }

  private static async waitForAttachedPanel(): Promise<VerticalTabsPanel | undefined> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const instance = VerticalTabsPanel.panels.current;
      if (instance) {
        return instance;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return undefined;
  }

  private static syncVisibilityContext(): void {
    void vscode.commands.executeCommand('setContext', 'verticalTabs.visible', hasVerticalTabsPanel());
  }

  private async ensureRail(layoutBeforeRail?: EditorLayout, previousEditor?: vscode.TextEditor): Promise<void> {
    this.arrangingRail = true;
    try {
      let ownGroupIndex = await this.waitForOwnGroup();
      if (ownGroupIndex < 0) {
        return;
      }

      if (!await this.activateOwnGroup()) {
        return;
      }
      let ownGroup = vscode.window.tabGroups.all[ownGroupIndex];
      if (ownGroup.tabs.length > 1) {
        await vscode.commands.executeCommand('workbench.action.newGroupLeft');
        if (!await this.activateOwnGroup()) {
          return;
        }
        await vscode.commands.executeCommand('workbench.action.moveEditorToLeftGroup');
        ownGroupIndex = await this.waitForOwnGroup();
        if (ownGroupIndex < 0) {
          return;
        }
        ownGroup = vscode.window.tabGroups.all[ownGroupIndex];
      }

      for (let moves = 0; ownGroupIndex > 0 && moves < vscode.window.tabGroups.all.length; moves += 1) {
        if (!await this.activateOwnGroup()) {
          return;
        }
        await vscode.commands.executeCommand('workbench.action.moveActiveEditorGroupLeft');
        ownGroupIndex = await this.waitForOwnGroup();
        if (ownGroupIndex < 0) {
          return;
        }
      }

      if (this.findOwnGroupIndex() !== 0) {
        return;
      }

      const width = this.preferredWidth();
      if (layoutBeforeRail && countLayoutLeaves(layoutBeforeRail) + 1 === vscode.window.tabGroups.all.length) {
        await applyEditorLayout(prependRailToLayout(layoutBeforeRail, width));
      } else {
        await this.applyRailWidth(width);
      }
      await this.applyRailWidth(width);

      if (!await this.activateOwnGroup()) {
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
    } finally {
      this.arrangingRail = false;
    }
  }

  private preferredWidth(): number {
    const remembered = this.context.globalState.get<number>(WIDTH_STORAGE_KEY);
    if (typeof remembered === 'number') {
      return normalizeRailWidth(remembered);
    }
    const configured = vscode.workspace.getConfiguration('verticalTabs').get<number>('defaultRailWidth', 280);
    return normalizeRailWidth(configured);
  }

  private async applyRailWidth(width: number): Promise<void> {
    const layout = await getEditorLayout();
    if (!layout || countLayoutLeaves(layout) !== vscode.window.tabGroups.all.length) {
      return;
    }
    await applyEditorLayout(setLeadingRailWidth(layout, width));
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

  private async activateOwnGroup(): Promise<boolean> {
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One, false);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (vscode.window.tabGroups.activeTabGroup.tabs.some((tab) => isVerticalTabsPanel(tab))) {
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return false;
  }

  private dispose(): void {
    VerticalTabsPanel.panels.clear(this);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    queueMicrotask(() => VerticalTabsPanel.syncVisibilityContext());
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private reveal(preserveFocus: boolean): void {
    this.panel.reveal(this.panel.viewColumn, preserveFocus);
  }

  private async close(): Promise<void> {
    const group = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
    if (group && group.tabs.length === 1 && isVerticalTabsPanel(group.tabs[0])) {
      try {
        await vscode.window.tabGroups.close(group, true);
      } catch {
        // Falling back to panel disposal still removes the extension view.
      }
    }
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
      tabs: group.tabs.map((tab) => this.toSnapshotTab(tab)),
    }));
    return buildSnapshot(groups, this.revision, this.manualGroups);
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
      manualGroupId: this.manualGroupByTab.get(tab),
    };
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseWebviewMessage(value);
    if (!message) {
      return;
    }

    if (message.type === 'railWidth') {
      if (this.arrangingRail) {
        return;
      }
      await this.context.globalState.update(WIDTH_STORAGE_KEY, normalizeRailWidth(message.width));
      return;
    }

    if (message.type === 'ready' || message.type === 'requestRefresh') {
      this.refresh();
      return;
    }

    if (message.type === 'createGroup') {
      this.manualGroups.push({ id: crypto.randomBytes(9).toString('base64url'), name: message.name.trim(), collapsed: false });
      this.refresh();
      return;
    }
    if (message.type === 'renameGroup') {
      const group = this.manualGroups.find((candidate) => candidate.id === message.groupId);
      if (group) {
        const index = this.manualGroups.indexOf(group);
        this.manualGroups[index] = { ...group, name: message.name.trim() };
        this.refresh();
      }
      return;
    }
    if (message.type === 'toggleGroup') {
      const group = this.manualGroups.find((candidate) => candidate.id === message.groupId);
      if (group) {
        const index = this.manualGroups.indexOf(group);
        this.manualGroups[index] = { ...group, collapsed: !group.collapsed };
        this.refresh();
      }
      return;
    }
    if (message.type === 'deleteGroup') {
      const index = this.manualGroups.findIndex((candidate) => candidate.id === message.groupId);
      if (index >= 0) {
        this.manualGroups.splice(index, 1);
        for (const group of vscode.window.tabGroups.all) for (const tab of group.tabs) {
          if (this.manualGroupByTab.get(tab) === message.groupId) this.manualGroupByTab.delete(tab);
        }
        this.refresh();
      }
      return;
    }
    if (message.type === 'assignGroup') {
      if (message.groupId !== undefined && !this.manualGroups.some((group) => group.id === message.groupId)) return;
      const tab = this.resolveTab(message.target);
      if (tab) {
        if (message.groupId) this.manualGroupByTab.set(tab, message.groupId);
        else this.manualGroupByTab.delete(tab);
        this.refresh();
      }
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
    const tabs = this.currentSnapshot.tabs.filter((tab) => tab.isActivatable);
    if (tabs.length === 0) {
      return;
    }
    const activeIndex = tabs.findIndex((tab) => tab.isActive);
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
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'));
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vertical-tabs.css'));
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
    <header class="toolbar"><h1>${TITLE}</h1><span><button id="add-group" type="button" title="新建分组">新建分组</button><button id="close-saved" type="button" title="关闭已保存的标签">清理</button></span></header>
    <p id="description">正在同步打开的标签…</p>
    <section id="groups" aria-label="打开的编辑器标签"></section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function hasUserTabs(): boolean {
  return vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => !isVerticalTabsPanel(tab)));
}

function findVerticalTabsTab(): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups.all) {
    const tab = group.tabs.find((candidate) => isVerticalTabsPanel(candidate));
    if (tab) {
      return tab;
    }
  }
  return undefined;
}

function hasVerticalTabsPanel(): boolean {
  return findVerticalTabsTab() !== undefined;
}

async function openWelcomePage(): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes('workbench.action.openWelcomePage')) {
    await vscode.commands.executeCommand('workbench.action.openWelcomePage');
  } else if (commands.includes('workbench.action.openWalkthrough')) {
    await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'vscode.gettingStarted');
  } else if (commands.includes('workbench.action.openAgentSessionsWelcome')) {
    await vscode.commands.executeCommand('workbench.action.openAgentSessionsWelcome');
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function getEditorLayout(): Promise<EditorLayout | undefined> {
  try {
    const layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout');
    return isEditorLayout(layout) ? layout : undefined;
  } catch {
    return undefined;
  }
}

async function applyEditorLayout(layout: EditorLayout): Promise<void> {
  try {
    await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
  } catch {
    // The rail remains usable at VS Code's native split size when unavailable.
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
