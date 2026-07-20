import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import {
  DEFAULT_RAIL_RATIO,
  getEditorAreaWidth,
  getObservedRailRatio,
  getRailGroupRatio,
  isEditorLayout,
  normalizeRailRatio,
  resolveRailRatio,
  shouldPersistRailGroupRatio,
  shouldPersistObservedRailWidth,
  type EditorLayout,
} from '../layout/RailLayout';
import { logDebug, logError, logInfo, logTrace, logWarn } from '../logging/extensionLogger';
import { buildSnapshot, selectCloseTargets, type SnapshotSourceGroup, type SnapshotSourceTab, type TabInputKind } from '../tabs/TabSnapshot';
import { SingletonPanel } from './SingletonPanel';
import { type ExtensionMessage, type ManualTabGroup, type TabTarget, type VerticalTabsSnapshot, parseWebviewMessage } from './messages';

export const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';
const WIDTH_RATIO_STORAGE_KEY = 'verticalTabs.railWidthRatio';
const MAIN_THREAD_WEBVIEW_PREFIX = 'mainThreadWebview-';
const RAIL_SETTLE_DELAY_MS = 150;
const GROUP_PUBLISH_WAIT_ATTEMPTS = 50;
const GROUP_WAIT_INTERVAL_MS = 10;

export class VerticalTabsPanel {
  private static readonly panels = new SingletonPanel<VerticalTabsPanel>();
  private static readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
  private static serializerRegistered = false;
  private static operations: Promise<void> = Promise.resolve();
  private static visibilityOperations: Promise<void> = Promise.resolve();

  static readonly onDidChangeVisibility = VerticalTabsPanel.visibilityEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private revision = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  // Ignore the Webview's initial ResizeObserver report until VS Code has
  // finished creating and sizing the dedicated editor group.
  private arrangingRail = true;
  private lastObservedRailWidth: number | undefined;
  private emptyRailLayoutOperation: Promise<boolean> | undefined;
  private currentSnapshot: VerticalTabsSnapshot = { revision: 0, tabs: [], manualGroups: [] };
  private readonly manualGroups: ManualTabGroup[] = [];
  private readonly manualGroupByTab = new WeakMap<vscode.Tab, string>();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    logInfo('垂直标签面板实例已创建', { viewColumn: panel.viewColumn });
    this.configureWebview();
    // The panel can exist before VS Code publishes its tab through tabGroups.
    // Mark it visible from the instance itself so the launcher switches to its
    // close action immediately after the user clicks Open.
    void VerticalTabsPanel.setVisibilityContext(true);
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message).catch((error) => logError('处理 Webview 消息失败', error));
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleRefresh()),
    );
  }

  static initialize(context: vscode.ExtensionContext): void {
    logInfo('初始化垂直标签面板服务', { serializerRegistered: VerticalTabsPanel.serializerRegistered });
    if (!VerticalTabsPanel.serializerRegistered) {
      context.subscriptions.push(vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel: async (panel) => {
          logInfo('开始恢复持久化的垂直标签面板', { viewColumn: panel.viewColumn });
          const instance = VerticalTabsPanel.attach(panel, context);
          await VerticalTabsPanel.enqueue(() => instance.settleAndEnsureRail());
          logInfo('持久化的垂直标签面板恢复完成');
        },
      }));
      VerticalTabsPanel.serializerRegistered = true;
      logDebug('WebviewPanelSerializer 注册完成', { viewType: VIEW_TYPE });
    }
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => VerticalTabsPanel.panels.current?.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabs(() => VerticalTabsPanel.syncVisibilityContext()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => VerticalTabsPanel.syncVisibilityContext()),
    );
    VerticalTabsPanel.syncVisibilityContext();
    logDebug('计划在启动后自动打开垂直标签面板');
    void VerticalTabsPanel.open(context).catch((error) => logError('启动时自动打开垂直标签面板失败', error));
  }

  static open(context: vscode.ExtensionContext): Promise<VerticalTabsPanel | undefined> {
    return VerticalTabsPanel.enqueue(() => VerticalTabsPanel.openCore(context));
  }

  private static async openCore(context: vscode.ExtensionContext): Promise<VerticalTabsPanel | undefined> {
    logDebug('开始打开垂直标签面板', {
      attached: VerticalTabsPanel.panels.current !== undefined,
      publishedTab: hasVerticalTabsPanel(),
      editorGroups: vscode.window.tabGroups.all.length,
    });
    const existing = VerticalTabsPanel.panels.current;
    if (existing) {
      logDebug('复用已附加的垂直标签面板', { settled: existing.hasSettledRail() });
      const previousEditor = vscode.window.activeTextEditor;
      existing.reveal(false);
      if (!existing.hasSettledRail()) {
        await existing.settleAndEnsureRail(previousEditor);
      }
      return existing;
    }

    // A restored webview tab can be visible before VS Code invokes its serializer.
    // Wait for the serializer instead of creating a duplicate panel beside it.
    if (hasVerticalTabsPanel()) {
      logDebug('检测到待反序列化的垂直标签 Webview，等待附加实例');
      const restored = await VerticalTabsPanel.waitForAttachedPanel();
      VerticalTabsPanel.syncVisibilityContext();
      if (restored) {
        const previousEditor = vscode.window.activeTextEditor;
        restored.reveal(false);
        await restored.settleAndEnsureRail(previousEditor);
      } else {
        logWarn('等待已恢复的垂直标签面板实例超时');
      }
      return restored;
    }

    return VerticalTabsPanel.create(context);
  }

  static isOpen(): boolean {
    return VerticalTabsPanel.panels.current !== undefined || hasVerticalTabsPanel();
  }

  static async focus(context: vscode.ExtensionContext): Promise<void> {
    logDebug('请求聚焦垂直标签面板');
    const instance = await VerticalTabsPanel.open(context);
    instance?.reveal(false);
  }

  static async close(): Promise<void> {
    logDebug('请求关闭垂直标签面板');
    await VerticalTabsPanel.enqueue(async () => {
      const instance = VerticalTabsPanel.panels.current;
      if (instance) {
        await instance.close();
      } else {
        const tab = findVerticalTabsTab();
        if (tab) {
          logDebug('关闭尚未附加实例的垂直标签 Webview');
          await vscode.window.tabGroups.close(tab, true);
        } else {
          logDebug('关闭请求无需处理：面板不存在');
        }
      }
      VerticalTabsPanel.syncVisibilityContext();
    });
  }

  static dispose(): void {
    logDebug('释放垂直标签面板服务');
    VerticalTabsPanel.panels.current?.panel.dispose();
  }

  static async navigate(context: vscode.ExtensionContext, direction: 1 | -1): Promise<void> {
    logDebug('请求相邻标签导航', { direction });
    const instance = await VerticalTabsPanel.open(context);
    await instance?.navigate(direction);
  }

  private static async create(context: vscode.ExtensionContext): Promise<VerticalTabsPanel> {
    logInfo('开始创建新的垂直标签面板', { editorGroups: vscode.window.tabGroups.all.length });
    const previouslyActiveEditor = vscode.window.activeTextEditor;
    const ratio = await prepareLeftRailGroup(context);
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out'), vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      },
    );
    logDebug('WebviewPanel 创建完成', { viewType: VIEW_TYPE, requestedViewColumn: vscode.ViewColumn.One });
    const instance = VerticalTabsPanel.panels.show(
      () => new VerticalTabsPanel(panel, context),
      (existing) => existing.reveal(false),
    );
    await VerticalTabsPanel.setVisibilityContext(true);
    await instance.settleAndEnsureRail(previouslyActiveEditor, ratio);
    logInfo('新的垂直标签面板创建流程完成', { settled: instance.hasSettledRail() });
    return instance;
  }

  private static attach(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): VerticalTabsPanel {
    const existing = VerticalTabsPanel.panels.current;
    if (existing) {
      logWarn('检测到重复恢复的垂直标签面板，关闭重复实例');
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
        logDebug('已恢复的垂直标签面板实例完成附加', { attempts: attempt + 1 });
        return instance;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return undefined;
  }

  private static syncVisibilityContext(): void {
    void VerticalTabsPanel.setVisibilityContext(VerticalTabsPanel.isOpen());
  }

  private static setVisibilityContext(visible: boolean): Promise<void> {
    const update = VerticalTabsPanel.visibilityOperations.then(async () => {
      logTrace('更新垂直标签可见性上下文', { visible });
      await vscode.commands.executeCommand('setContext', 'verticalTabs.visible', visible);
      VerticalTabsPanel.visibilityEmitter.fire(visible);
    });
    VerticalTabsPanel.visibilityOperations = update.catch(() => undefined);
    return update;
  }

  private async settleAndEnsureRail(previousEditor?: vscode.TextEditor, preparedRatio?: number): Promise<void> {
    this.arrangingRail = true;
    logDebug('等待编辑器状态稳定后安排左侧标签栏', {
      delayMs: RAIL_SETTLE_DELAY_MS,
      previousEditor: previousEditor?.document.uri.toString(),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, RAIL_SETTLE_DELAY_MS));
    if (VerticalTabsPanel.panels.current !== this) {
      logWarn('安排左侧标签栏时面板实例已变化，终止本次操作');
      return;
    }

    try {
      if (await this.ensureRail(previousEditor, preparedRatio)) {
        this.arrangingRail = false;
        logInfo('左侧标签栏安排完成');
        return;
      }
    } catch (error) {
      logError('安排左侧标签栏时发生异常', error);
    }
    logError('左侧标签栏安排失败');
  }

  private async ensureRail(previousEditor?: vscode.TextEditor, preparedRatio?: number): Promise<boolean> {
    const initialGroupIndex = await this.waitForOwnGroup();
    if (initialGroupIndex < 0) {
      logWarn('未能在编辑器标签中找到垂直标签 Webview');
      return false;
    }
    logDebug('已找到垂直标签 Webview 所在分组', {
      groupIndex: initialGroupIndex,
      groupCount: vscode.window.tabGroups.all.length,
      tabCount: vscode.window.tabGroups.all[initialGroupIndex]?.tabs.length,
    });

    const finalGroup = vscode.window.tabGroups.all[initialGroupIndex];
    if (finalGroup?.viewColumn !== vscode.ViewColumn.One) {
      logWarn('垂直标签 Webview 未直接创建在第一个编辑器分组', {
        groupIndex: initialGroupIndex,
        viewColumn: finalGroup?.viewColumn,
      });
      return false;
    }

    if (finalGroup.tabs.length !== 1 || !isVerticalTabsPanel(finalGroup.tabs[0])) {
      logWarn('锁定前左侧分组状态不符合预期', {
        tabCount: finalGroup.tabs.length,
        containsVerticalTabs: finalGroup.tabs.some((tab) => isVerticalTabsPanel(tab)),
      });
      return false;
    }
    if (preparedRatio !== undefined) {
      // VS Code publishes the new group before its native split layout has
      // committed. Wait one event-loop turn, then write the width once.
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
      if (!await applyLeadingRailRatio(preparedRatio)) {
        logWarn('无法在创建垂直标签 Webview 后应用宽度比例');
        return false;
      }
      await this.context.globalState.update(WIDTH_RATIO_STORAGE_KEY, preparedRatio);
      logDebug('保存首次使用的垂直标签栏宽度比例', { ratio: preparedRatio });
    }
    this.panel.reveal(vscode.ViewColumn.One, false);
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    logInfo('左侧垂直标签分组已锁定');
    if (previousEditor) {
      const restoredViewColumn = findTextDocumentViewColumn(previousEditor.document.uri) ?? previousEditor.viewColumn;
      await vscode.window.showTextDocument(previousEditor.document, {
        viewColumn: restoredViewColumn,
        preserveFocus: false,
        selection: previousEditor.selection,
      });
      logDebug('已恢复安排布局前的活动文本编辑器', {
        uri: previousEditor.document.uri.toString(),
        viewColumn: restoredViewColumn,
      });
    }
    this.refresh();
    return true;
  }

  private async saveEditorWidthRatio(): Promise<void> {
    const layout = await getEditorLayout();
    let ratio: number | undefined;
    if (layout && shouldPersistRailGroupRatio(layout)) {
      ratio = getRailGroupRatio(layout);
    } else if (this.lastObservedRailWidth !== undefined) {
      ratio = shouldPersistObservedRailWidth(layout, this.lastObservedRailWidth)
        ? getObservedRailRatio(layout, this.lastObservedRailWidth)
        : undefined;
    }
    if (typeof ratio === 'number') {
      const normalizedRatio = normalizeRailRatio(ratio);
      await this.context.globalState.update(WIDTH_RATIO_STORAGE_KEY, normalizedRatio);
      logDebug('保存用户调整后的垂直标签栏宽度比例', { measuredRatio: ratio, savedRatio: normalizedRatio });
    } else {
      logDebug('跳过保存垂直标签栏宽度比例：当前布局没有独立的右侧编辑器区域', { layout });
    }
  }

  private hasSettledRail(): boolean {
    const ownGroupIndex = this.findOwnGroupIndex();
    const ownGroup = vscode.window.tabGroups.all[ownGroupIndex];
    return !this.arrangingRail
      && ownGroup?.viewColumn === vscode.ViewColumn.One
      && ownGroup?.tabs.length === 1
      && isVerticalTabsPanel(ownGroup.tabs[0]);
  }

  private findOwnGroupIndex(): number {
    return vscode.window.tabGroups.all.findIndex((group) => group.tabs.some((tab) => isVerticalTabsPanel(tab)));
  }

  private async waitForOwnGroup(): Promise<number> {
    for (let attempt = 0; attempt < GROUP_PUBLISH_WAIT_ATTEMPTS; attempt += 1) {
      const index = this.findOwnGroupIndex();
      if (index >= 0) {
        logTrace('垂直标签 Webview 已发布到编辑器分组', { index, attempts: attempt + 1 });
        return index;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
    }
    logWarn('等待垂直标签 Webview 发布超时', { attempts: GROUP_PUBLISH_WAIT_ATTEMPTS });
    return -1;
  }

  private dispose(): void {
    logInfo('垂直标签面板实例已释放');
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
    logTrace('显示垂直标签面板', { viewColumn: this.panel.viewColumn, preserveFocus });
    this.panel.reveal(this.panel.viewColumn, preserveFocus);
  }

  private async close(): Promise<void> {
    logInfo('开始关闭垂直标签面板');
    await this.saveEditorWidthRatio();
    const group = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
    if (group && group.tabs.length === 1 && isVerticalTabsPanel(group.tabs[0])) {
      try {
        await vscode.window.tabGroups.close(group, true);
        logDebug('已关闭垂直标签专用编辑器分组');
      } catch (error) {
        // Falling back to panel disposal still removes the extension view.
        logWarn('关闭垂直标签专用编辑器分组失败，将回退到释放面板', error);
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
    logTrace('刷新垂直标签快照', {
      revision: this.currentSnapshot.revision,
      tabCount: this.currentSnapshot.tabs.length,
      manualGroupCount: this.currentSnapshot.manualGroups.length,
    });
    this.postMessage({ type: 'renderTabs', title: TITLE, snapshot: this.currentSnapshot });
    void this.ensureUsableEmptyRailLayout().catch((error) => logError('恢复空垂直标签栏布局失败', error));
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
      logWarn('忽略无效或未知的 Webview 消息', { valueType: typeof value });
      return;
    }
    logDebug('收到 Webview 消息', { type: message.type });

    if (message.type === 'railWidth') {
      this.lastObservedRailWidth = message.width;
      logDebug('观察到垂直标签 Webview 宽度', { width: message.width, arrangingRail: this.arrangingRail });
      if (this.arrangingRail) {
        return;
      }
      if (await this.ensureUsableEmptyRailLayout()) {
        return;
      }
      await this.saveEditorWidthRatio();
      return;
    }

    if (message.type === 'ready' || message.type === 'requestRefresh') {
      logDebug('Webview 请求刷新标签快照', { type: message.type });
      this.refresh();
      return;
    }

    if (message.type === 'createGroup') {
      logInfo('创建手动标签分组', { name: message.name.trim() });
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
        logInfo('重命名手动标签分组', { groupId: message.groupId, name: message.name.trim() });
      } else {
        logWarn('重命名手动标签分组失败：分组不存在', { groupId: message.groupId });
      }
      return;
    }
    if (message.type === 'toggleGroup') {
      const group = this.manualGroups.find((candidate) => candidate.id === message.groupId);
      if (group) {
        const index = this.manualGroups.indexOf(group);
        this.manualGroups[index] = { ...group, collapsed: !group.collapsed };
        this.refresh();
        logDebug('切换手动标签分组折叠状态', { groupId: message.groupId, collapsed: !group.collapsed });
      } else {
        logWarn('切换手动标签分组失败：分组不存在', { groupId: message.groupId });
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
        logInfo('删除手动标签分组', { groupId: message.groupId });
      } else {
        logWarn('删除手动标签分组失败：分组不存在', { groupId: message.groupId });
      }
      return;
    }
    if (message.type === 'assignGroup') {
      if (message.groupId !== undefined && !this.manualGroups.some((group) => group.id === message.groupId)) {
        logWarn('分配标签到手动分组失败：分组不存在', { groupId: message.groupId });
        return;
      }
      const tab = this.resolveTab(message.target);
      if (tab) {
        if (message.groupId) this.manualGroupByTab.set(tab, message.groupId);
        else this.manualGroupByTab.delete(tab);
        this.refresh();
        logInfo('更新标签的手动分组', { label: tab.label, groupId: message.groupId });
      } else {
        logWarn('更新标签手动分组失败：标签目标已失效', { target: message.target });
      }
      return;
    }

    if (message.type === 'activateTab') {
      const tab = this.resolveTab(message.target);
      if (tab) {
        logDebug('激活标签', { label: tab.label, inputKind: inputKind(tab.input), group: tab.group.viewColumn });
        await this.activateTab(tab);
      } else {
        logWarn('激活标签失败：标签目标已失效', { target: message.target });
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
    logInfo('执行标签关闭操作', { action, selectedTargets: targets.length, resolvedTabs: tabs.length });
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs, true);
    }
    this.refresh();
  }

  private resolveTab(target: TabTarget): vscode.Tab | undefined {
    if (target.revision !== this.currentSnapshot.revision) {
      logWarn('标签目标快照版本已失效', { targetRevision: target.revision, currentRevision: this.currentSnapshot.revision });
      return undefined;
    }
    const tab = vscode.window.tabGroups.all[target.groupIndex]?.tabs[target.tabIndex];
    return tab && !isVerticalTabsPanel(tab) ? tab : undefined;
  }

  private async navigate(direction: 1 | -1): Promise<void> {
    this.refresh();
    const tabs = this.currentSnapshot.tabs.filter((tab) => tab.isActivatable);
    if (tabs.length === 0) {
      logDebug('相邻标签导航无需处理：没有可激活标签');
      return;
    }
    const activeIndex = tabs.findIndex((tab) => tab.isActive);
    const index = activeIndex < 0 ? 0 : (activeIndex + direction + tabs.length) % tabs.length;
    const tab = this.resolveTab(tabs[index].target);
    if (tab) {
      logDebug('相邻标签导航选择目标', { direction, label: tab.label, inputKind: inputKind(tab.input) });
      await this.activateTab(tab);
    }
  }

  private async activateTab(tab: vscode.Tab): Promise<void> {
    logDebug('使用公开 API 打开标签', { label: tab.label, inputKind: inputKind(tab.input), viewColumn: tab.group.viewColumn });
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
      return;
    }
    logWarn('标签类型不支持通过公开 API 激活', { label: tab.label, inputKind: inputKind(tab.input) });
  }

  private postMessage(message: ExtensionMessage): void {
    void this.panel.webview.postMessage(message).then((delivered) => {
      if (!delivered) {
        logWarn('向 Webview 发送消息未送达', { type: message.type });
      }
    }, (error) => logError('向 Webview 发送消息失败', { type: message.type, error }));
  }

  private configureWebview(): void {
    logDebug('配置垂直标签 Webview HTML 与 CSP');
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

  private async ensureUsableEmptyRailLayout(): Promise<boolean> {
    if (this.emptyRailLayoutOperation) {
      return this.emptyRailLayoutOperation;
    }
    if (!this.hasSettledRail() || this.currentSnapshot.tabs.length > 0) {
      return false;
    }
    const groups = vscode.window.tabGroups.all;
    if (groups.length !== 1 || groups[0]?.tabs.length !== 1 || !isVerticalTabsPanel(groups[0].tabs[0])) {
      return false;
    }

    this.emptyRailLayoutOperation = this.restoreUsableEmptyRailLayout();
    try {
      return await this.emptyRailLayoutOperation;
    } finally {
      this.emptyRailLayoutOperation = undefined;
    }
  }

  private async restoreUsableEmptyRailLayout(): Promise<boolean> {
    const ratio = getConfiguredRailRatio(this.context);
    logInfo('检测到垂直标签栏成为唯一编辑器组，准备恢复右侧编辑器区域', { ratio });
    this.arrangingRail = true;
    try {
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      await openWelcomeEditor();
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
      if (!await applyLeadingRailRatio(ratio)) {
        logWarn('恢复空垂直标签栏宽度失败');
        return false;
      }
      this.panel.reveal(vscode.ViewColumn.One, false);
      await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
      logInfo('已恢复空垂直标签栏的右侧编辑器区域和宽度', { ratio });
      return true;
    } finally {
      this.arrangingRail = false;
    }
  }
}

async function openWelcomeEditor(): Promise<void> {
  const attempts: Array<readonly [string, ...unknown[]]> = [
    ['workbench.action.openWelcome'],
    ['workbench.action.openWalkthrough', 'gettingStarted', false],
    ['workbench.action.openWalkthrough', { category: 'gettingStarted' }, false],
  ];
  for (const [command, ...args] of attempts) {
    try {
      await withTimeout(vscode.commands.executeCommand(command, ...args), 300);
      logDebug('已在右侧编辑器区域打开 VS Code 欢迎页', { command });
      return;
    } catch (error) {
      logDebug('尝试打开 VS Code 欢迎页失败', { command, error });
    }
  }
  logWarn('打开 VS Code 欢迎页失败，将保留空的右侧编辑器组');
}

function withTimeout<T>(promise: Thenable<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
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

function findTextDocumentViewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    if (group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString())) {
      return group.viewColumn;
    }
  }
  return undefined;
}

function hasVerticalTabsPanel(): boolean {
  return findVerticalTabsTab() !== undefined;
}

async function getEditorLayout(): Promise<EditorLayout | undefined> {
  try {
    const layout = await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout');
    if (!isEditorLayout(layout)) {
      logWarn('vscode.getEditorLayout 返回了无效布局', { layout });
      return undefined;
    }
    logDebug('读取编辑器布局', { layout });
    return layout;
  } catch (error) {
    logError('读取编辑器布局失败', error);
    return undefined;
  }
}

async function applyEditorLayout(layout: EditorLayout): Promise<boolean> {
  try {
    logDebug('应用编辑器布局', { layout });
    await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
    logDebug('编辑器布局命令执行完成');
    return true;
  } catch (error) {
    // The rail remains usable at VS Code's native split size when unavailable.
    logError('应用编辑器布局失败', { layout, error });
    return false;
  }
}

async function prepareLeftRailGroup(context: vscode.ExtensionContext): Promise<number | undefined> {
  const savedRatio = context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY);
  const configuredRatio = vscode.workspace.getConfiguration('verticalTabs').get<number>('defaultRailWidthRatio', DEFAULT_RAIL_RATIO);
  const ratio = getConfiguredRailRatio(context);
  try {
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    await vscode.commands.executeCommand('workbench.action.newGroupLeft');
    logDebug('在创建 Webview 前通过原生命令新建左侧空编辑器分组', {
      editorGroups: vscode.window.tabGroups.all.length,
      savedRatio,
      configuredRatio,
      ratio,
    });
    return ratio;
  } catch (error) {
    logError('创建左侧空编辑器分组失败', { savedRatio, configuredRatio, ratio, error });
    return undefined;
  }
}

function getConfiguredRailRatio(context: vscode.ExtensionContext): number {
  const savedRatio = context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY);
  const configuredRatio = vscode.workspace.getConfiguration('verticalTabs').get<number>('defaultRailWidthRatio', DEFAULT_RAIL_RATIO);
  return resolveRailRatio(savedRatio, configuredRatio);
}

async function applyLeadingRailRatio(ratio: number): Promise<boolean> {
  const layout = await getEditorLayout();
  if (!layout || layout.orientation !== 0 || layout.groups.length < 2) {
    logWarn('无法在当前布局中调整左侧标签栏宽度', { layout });
    return false;
  }
  const totalWidth = getEditorAreaWidth(layout);
  const railWidth = Math.max(1, Math.ceil(totalWidth * normalizeRailRatio(ratio)));
  logDebug('创建 Webview 后调整左侧标签栏宽度', { ratio, totalWidth, railWidth });
  const siblingWidths = layout.groups.slice(1).map((group) => typeof group.size === 'number' && group.size > 0 ? group.size : 1);
  const siblingTotal = siblingWidths.reduce((sum, size) => sum + size, 0);
  const availableWidth = Math.max(1, totalWidth - railWidth);
  return applyEditorLayout({
    ...layout,
    groups: [
      { ...layout.groups[0], size: railWidth },
      ...layout.groups.slice(1).map((group, index) => ({
        ...group,
        size: Math.max(1, Math.round(availableWidth * siblingWidths[index] / siblingTotal)),
      })),
    ],
  });
}

function isVerticalTabsPanel(tab: vscode.Tab): boolean {
  if (!(tab.input instanceof vscode.TabInputWebview)) {
    return false;
  }
  return tab.input.viewType === VIEW_TYPE
    || tab.input.viewType === `${MAIN_THREAD_WEBVIEW_PREFIX}${VIEW_TYPE}`;
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
