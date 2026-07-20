import * as crypto from 'node:crypto';
import * as path from 'node:path';
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
import { buildSnapshot, identityKey, sameIdentity, selectCloseTargets, type SnapshotSourceGroup, type SnapshotSourceTab, type TabInputKind } from '../tabs/TabSnapshot';
import { SingletonPanel } from './SingletonPanel';
import { type ExtensionMessage, type GroupMode, type ManualTabGroup, type SortMode, type TabTarget, type TabTargetIdentity, type VerticalTabsSnapshot, parseWebviewMessage } from './messages';

export const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';
const WIDTH_RATIO_STORAGE_KEY = 'verticalTabs.railWidthRatio';
const GROUP_MODE_STORAGE_KEY = 'verticalTabs.groupMode';
const SORT_MODE_STORAGE_KEY = 'verticalTabs.sortMode';
const MANUAL_GROUPS_STORAGE_KEY = 'verticalTabs.manualGroups';
const MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY = 'verticalTabs.manualGroupByIdentity';
const MANUAL_ORDER_BY_GROUP_STORAGE_KEY = 'verticalTabs.manualOrderByGroup';
const MAIN_THREAD_WEBVIEW_PREFIX = 'mainThreadWebview-';
const RAIL_SETTLE_DELAY_MS = 150;
const GROUP_PUBLISH_WAIT_ATTEMPTS = 50;
const GROUP_WAIT_INTERVAL_MS = 10;
const INPUT_MTIME_TIMEOUT_MS = 250;
const INITIAL_HOST_REFRESH_DELAY_MS = 800;
const MAX_EMPTY_RAIL_RESTORE_RATIO = 0.4;

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
  private initialHostRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  // Ignore the Webview's initial ResizeObserver report until VS Code has
  // finished creating and sizing the dedicated editor group.
  private arrangingRail = true;
  private lastObservedRailWidth: number | undefined;
  private emptyRailLayoutOperation: Promise<boolean> | undefined;
  private currentSnapshot: VerticalTabsSnapshot = { revision: 0, groupMode: 'vscode', sortMode: 'none', tabs: [], manualGroups: [], displayGroups: [] };
  private groupMode: GroupMode;
  private sortMode: SortMode;
  private readonly manualGroups: ManualTabGroup[];
  private readonly manualGroupByIdentity: Map<string, string>;
  private readonly manualOrderByGroup: Map<string, string[]>;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.groupMode = readGroupMode(context);
    this.sortMode = readSortMode(context);
    this.manualGroups = readManualGroups(context);
    this.manualGroupByIdentity = readStringMap(context, MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY);
    this.manualOrderByGroup = readStringArrayMap(context, MANUAL_ORDER_BY_GROUP_STORAGE_KEY);
    logInfo('垂直标签面板实例已创建', { viewColumn: panel.viewColumn });
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message).catch((error) => logError('处理 Webview 消息失败', error));
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleRefresh()),
    );
    this.configureWebview();
    this.scheduleInitialHostRefresh();
    // The panel can exist before VS Code publishes its tab through tabGroups.
    // Mark it visible from the instance itself so the launcher switches to its
    // close action immediately after the user clicks Open.
    void VerticalTabsPanel.setVisibilityContext(true);
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
    if (!await this.focusAndLockOwnGroup()) {
      return false;
    }
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
    await this.refresh({ reason: 'ensureRail' });
    return true;
  }

  private async saveEditorWidthRatio(): Promise<void> {
    if (!this.hasVisibleUserTabs()) {
      logDebug('跳过保存垂直标签栏宽度比例：当前没有可显示的用户标签');
      return;
    }
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

  private hasVisibleUserTabs(): boolean {
    return vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => !isVerticalTabsPanel(tab)));
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

  private async focusAndLockOwnGroup(): Promise<boolean> {
    const ownGroup = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
    if (!ownGroup || !ownGroup.tabs.some((tab) => isVerticalTabsPanel(tab))) {
      logWarn('锁定垂直标签分组失败：找不到面板所在分组');
      return false;
    }
    await focusEditorGroup(ownGroup.viewColumn);
    this.panel.reveal(ownGroup.viewColumn ?? vscode.ViewColumn.One, false);
    await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    return true;
  }

  private scheduleInitialHostRefresh(): void {
    if (this.initialHostRefreshTimer) {
      clearTimeout(this.initialHostRefreshTimer);
    }
    this.initialHostRefreshTimer = setTimeout(() => {
      this.initialHostRefreshTimer = undefined;
      void this.refresh({ reason: 'hostInitialFallback', ensureEmptyLayout: false }).catch((error) => logError('初始兜底刷新垂直标签快照失败', error));
    }, INITIAL_HOST_REFRESH_DELAY_MS);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      logTrace('跳过计划刷新：已有刷新定时器');
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh({ reason: 'scheduled' }).catch((error) => logError('刷新垂直标签快照失败', error));
    }, 0);
  }

  private async refresh(options: { readonly reason: string; readonly ensureEmptyLayout?: boolean }): Promise<void> {
    const started = Date.now();
    logDebug('开始刷新垂直标签快照', {
      reason: options.reason,
      arrangingRail: this.arrangingRail,
      groupCount: vscode.window.tabGroups.all.length,
    });
    this.currentSnapshot = await this.createSnapshot();
    logDebug('完成刷新垂直标签快照', {
      reason: options.reason,
      revision: this.currentSnapshot.revision,
      tabCount: this.currentSnapshot.tabs.length,
      displayGroupCount: this.currentSnapshot.displayGroups.length,
      manualGroupCount: this.currentSnapshot.manualGroups.length,
      groupMode: this.currentSnapshot.groupMode,
      sortMode: this.currentSnapshot.sortMode,
      durationMs: Date.now() - started,
    });
    this.postMessage({ type: 'renderTabs', title: TITLE, snapshot: this.currentSnapshot });
    if (options.ensureEmptyLayout !== false) {
      void this.ensureUsableEmptyRailLayout().catch((error) => logError('恢复空垂直标签栏布局失败', error));
    }
  }

  private async createSnapshot(): Promise<VerticalTabsSnapshot> {
    this.revision += 1;
    const revision = this.revision;
    logDebug('开始创建标签快照', {
      revision,
      sourceGroups: vscode.window.tabGroups.all.map((group, index) => ({ index, viewColumn: group.viewColumn, tabCount: group.tabs.length })),
    });
    const groups: SnapshotSourceGroup[] = await Promise.all(vscode.window.tabGroups.all.map(async (group, index) => ({
      label: `编辑器组 ${index + 1}`,
      viewColumn: group.viewColumn,
      tabs: await Promise.all(group.tabs.map((tab) => this.toSnapshotTab(tab))),
    })));
    const snapshot = buildSnapshot(groups, revision, this.manualGroups, {
      groupMode: this.groupMode,
      sortMode: this.sortMode,
      manualOrderByGroup: this.manualOrderByGroup,
    });
    logDebug('标签快照创建完成', { revision, visibleTabs: snapshot.tabs.length, displayGroups: snapshot.displayGroups.length });
    return snapshot;
  }

  private async toSnapshotTab(tab: vscode.Tab): Promise<SnapshotSourceTab> {
    const path = inputPath(tab.input);
    return {
      label: tab.label,
      isActive: tab.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      inputKind: inputKind(tab.input),
      path,
      uri: inputUri(tab.input)?.toString(),
      mtime: await inputMtime(tab.input),
      targetIdentity: targetIdentity(tab),
      isActivatable: isActivatableTab(tab),
      isVerticalTabsPanel: isVerticalTabsPanel(tab),
      manualGroupId: this.manualGroupByIdentity.get(identityKey(targetIdentity(tab))),
    };
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseWebviewMessage(value);
    if (!message) {
      logWarn('忽略无效或未知的 Webview 消息', { valueType: typeof value });
      return;
    }
    logDebug('收到 Webview 消息', { type: message.type });

    if (message.type === 'webviewLog') {
      const details = message.details ? { details: message.details } : undefined;
      if (message.level === 'error') logError(`Webview: ${message.message}`, details);
      else if (message.level === 'warn') logWarn(`Webview: ${message.message}`, details);
      else logDebug(`Webview: ${message.message}`, details);
      return;
    }

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
      if (message.type === 'ready' && this.initialHostRefreshTimer) {
        clearTimeout(this.initialHostRefreshTimer);
        this.initialHostRefreshTimer = undefined;
      }
      logDebug('Webview 请求刷新标签快照', { type: message.type });
      await this.refresh({ reason: message.type });
      return;
    }

    if (message.type === 'setGroupMode') {
      this.groupMode = message.groupMode;
      await this.context.workspaceState.update(GROUP_MODE_STORAGE_KEY, message.groupMode);
      logInfo('切换垂直标签分组模式', { groupMode: message.groupMode });
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'setSortMode') {
      this.sortMode = message.sortMode;
      await this.context.workspaceState.update(SORT_MODE_STORAGE_KEY, message.sortMode);
      logInfo('切换垂直标签排序模式', { sortMode: message.sortMode });
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'createGroup') {
      if (this.groupMode !== 'manual') {
        this.groupMode = 'manual';
        await this.context.workspaceState.update(GROUP_MODE_STORAGE_KEY, this.groupMode);
      }
      logInfo('创建手动标签分组', { name: message.name.trim() });
      this.manualGroups.push({ id: crypto.randomBytes(9).toString('base64url'), name: message.name.trim(), collapsed: false });
      await this.persistManualGroups();
      await this.refresh({ reason: 'operation' });
      return;
    }
    if (message.type === 'renameGroup') {
      const group = this.manualGroups.find((candidate) => candidate.id === message.groupId);
      if (group) {
        const index = this.manualGroups.indexOf(group);
        this.manualGroups[index] = { ...group, name: message.name.trim() };
        await this.persistManualGroups();
        await this.refresh({ reason: 'operation' });
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
        await this.persistManualGroups();
        await this.refresh({ reason: 'operation' });
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
        for (const [key, groupId] of this.manualGroupByIdentity) {
          if (groupId === message.groupId) this.manualGroupByIdentity.delete(key);
        }
        this.manualOrderByGroup.delete(message.groupId);
        await this.persistManualState();
        await this.refresh({ reason: 'operation' });
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
        this.setManualGroup(targetIdentity(tab), message.groupId);
        await this.persistManualState();
        await this.refresh({ reason: 'operation' });
        logInfo('更新标签的手动分组', { label: tab.label, groupId: message.groupId });
      } else {
        logWarn('更新标签手动分组失败：标签目标已失效', { target: message.target });
      }
      return;
    }

    if (message.type === 'moveTab' || message.type === 'reorderManualTab') {
      if (this.groupMode === 'manual') {
        await this.moveManualTab(message.target, message.groupId, message.beforeTarget);
      } else if (this.groupMode === 'vscode') {
        await this.moveEditorWithinVsCode(message.target, message.beforeTarget);
      } else {
        this.groupMode = 'manual';
        await this.context.workspaceState.update(GROUP_MODE_STORAGE_KEY, this.groupMode);
        await this.moveManualTab(message.target, message.groupId, message.beforeTarget);
      }
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'createGroupFromTabs') {
      await this.createManualGroupFromTabs(message.source, message.target);
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'pinTab' || message.type === 'unpinTab') {
      const tab = this.resolveTab(message.target);
      if (tab && isActivatableTabForCommands(tab)) {
        await this.activateTab(tab);
        await vscode.commands.executeCommand(message.type === 'pinTab' ? 'workbench.action.pinEditor' : 'workbench.action.unpinEditor');
      } else {
        logWarn('固定状态切换失败：标签不可可靠激活', { target: message.target });
      }
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'moveToPreviousGroup' || message.type === 'moveToNextGroup' || message.type === 'moveToNewGroup') {
      const tab = this.resolveTab(message.target);
      if (tab && isActivatableTabForCommands(tab)) {
        await this.activateTab(tab);
        const command = message.type === 'moveToPreviousGroup'
          ? 'workbench.action.moveEditorToPreviousGroup'
          : message.type === 'moveToNextGroup'
            ? 'workbench.action.moveEditorToNextGroup'
            : 'workbench.action.moveEditorToNewGroup';
        await vscode.commands.executeCommand(command);
      }
      await this.refresh({ reason: 'operation' });
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
          : message.type === 'closeAll'
            ? 'closeAll'
            : 'closeSaved';
    const targets = selectCloseTargets(this.currentSnapshot, action, 'target' in message ? message.target : undefined);
    const tabs = targets.map((target) => this.resolveTab(target)).filter((tab): tab is vscode.Tab => tab !== undefined);
    logInfo('执行标签关闭操作', { action, selectedTargets: targets.length, resolvedTabs: tabs.length });
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs, true);
    }
    await this.refresh({ reason: 'navigate' });
  }

  private setManualGroup(identity: TabTargetIdentity, groupId: string | undefined): void {
    const key = identityKey(identity);
    if (groupId) this.manualGroupByIdentity.set(key, groupId);
    else this.manualGroupByIdentity.delete(key);
  }

  private async moveManualTab(target: TabTarget, groupId: string | undefined, beforeTarget: TabTarget | undefined): Promise<void> {
    const tab = this.resolveTab(target);
    if (!tab) {
      logWarn('手动移动标签失败：标签目标已失效', { target });
      return;
    }
    const destinationGroupId = groupId ?? '__ungrouped';
    if (groupId !== undefined && !this.manualGroups.some((group) => group.id === groupId)) {
      logWarn('手动移动标签失败：分组不存在', { groupId });
      return;
    }
    const key = identityKey(targetIdentity(tab));
    this.setManualGroup(targetIdentity(tab), groupId);
    const beforeKey = beforeTarget ? identityKey(beforeTarget.identity) : undefined;
    this.insertManualOrder(destinationGroupId, key, beforeKey);
    await this.persistManualState();
    logInfo('手动移动标签完成', { label: tab.label, groupId });
  }

  private async createManualGroupFromTabs(sourceTarget: TabTarget, targetTarget: TabTarget): Promise<void> {
    const source = this.resolveTab(sourceTarget);
    const target = this.resolveTab(targetTarget);
    if (!source || !target || sameIdentity(targetIdentity(source), targetIdentity(target))) {
      logWarn('通过拖拽创建分组失败：标签目标无效或相同');
      return;
    }
    if (this.groupMode !== 'manual') {
      this.groupMode = 'manual';
      await this.context.workspaceState.update(GROUP_MODE_STORAGE_KEY, this.groupMode);
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const name = defaultManualGroupName(source, target);
    this.manualGroups.push({ id, name, collapsed: false });
    const sourceKey = identityKey(targetIdentity(source));
    const targetKey = identityKey(targetIdentity(target));
    this.setManualGroup(targetIdentity(source), id);
    this.setManualGroup(targetIdentity(target), id);
    this.manualOrderByGroup.set(id, [targetKey, sourceKey]);
    await this.persistManualState();
    logInfo('通过拖拽创建手动分组', { id, name, source: source.label, target: target.label });
  }

  private insertManualOrder(groupId: string, key: string, beforeKey: string | undefined): void {
    const current = (this.manualOrderByGroup.get(groupId) ?? []).filter((candidate) => candidate !== key);
    const beforeIndex = beforeKey ? current.indexOf(beforeKey) : -1;
    if (beforeIndex >= 0) current.splice(beforeIndex, 0, key);
    else current.push(key);
    this.manualOrderByGroup.set(groupId, current);
  }

  private async moveEditorWithinVsCode(target: TabTarget, beforeTarget: TabTarget | undefined): Promise<void> {
    const tab = this.resolveTab(target);
    if (!tab || !isActivatableTabForCommands(tab)) {
      logWarn('跟随 VS Code 模式移动失败：标签不可可靠激活', { target });
      return;
    }
    const beforeTab = beforeTarget ? this.resolveTab(beforeTarget) : undefined;
    await this.activateTab(tab);
    if (beforeTab && beforeTab.group === tab.group) {
      const targetIndex = tab.group.tabs.indexOf(tab);
      const beforeIndex = tab.group.tabs.indexOf(beforeTab);
      if (targetIndex > beforeIndex) await vscode.commands.executeCommand('workbench.action.moveEditorLeftInGroup');
      else if (targetIndex < beforeIndex) await vscode.commands.executeCommand('workbench.action.moveEditorRightInGroup');
    }
  }

  private async persistManualGroups(): Promise<void> {
    await this.context.workspaceState.update(MANUAL_GROUPS_STORAGE_KEY, this.manualGroups);
  }

  private async persistManualState(): Promise<void> {
    await Promise.all([
      this.persistManualGroups(),
      this.context.workspaceState.update(MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY, Array.from(this.manualGroupByIdentity.entries())),
      this.context.workspaceState.update(MANUAL_ORDER_BY_GROUP_STORAGE_KEY, Array.from(this.manualOrderByGroup.entries())),
    ]);
  }

  private resolveTab(target: TabTarget): vscode.Tab | undefined {
    const indexedTab = vscode.window.tabGroups.all[target.groupIndex]?.tabs[target.tabIndex];
    if (indexedTab && !isVerticalTabsPanel(indexedTab) && sameIdentity(targetIdentity(indexedTab), target.identity)) {
      if (target.revision !== this.currentSnapshot.revision) {
        logDebug('通过稳定标识接受过期快照中的索引标签目标', {
          targetRevision: target.revision,
          currentRevision: this.currentSnapshot.revision,
          label: indexedTab.label,
        });
      }
      return indexedTab;
    }
    if (indexedTab && !isVerticalTabsPanel(indexedTab) && target.revision === this.currentSnapshot.revision) {
      logDebug('同一快照版本内按索引解析标签目标', { label: indexedTab.label });
      return indexedTab;
    }
    if (target.revision !== this.currentSnapshot.revision) {
      logDebug('标签目标快照版本已变化，按稳定标识重新查找', { targetRevision: target.revision, currentRevision: this.currentSnapshot.revision });
    }
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!isVerticalTabsPanel(tab) && sameIdentity(targetIdentity(tab), target.identity)) {
          return tab;
        }
      }
    }
    logWarn('无法按稳定标识解析标签目标', { target });
    return undefined;
  }

  private async navigate(direction: 1 | -1): Promise<void> {
    await this.refresh({ reason: 'operation' });
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
    const builtInWebviewTarget = getActivatableBuiltInWebviewTarget(tab);
    if (builtInWebviewTarget === 'welcome') {
      await focusEditorGroup(tab.group.viewColumn);
      await openWelcomeEditor();
      return;
    }
    if (builtInWebviewTarget === 'settings') {
      await focusEditorGroup(tab.group.viewColumn);
      await vscode.commands.executeCommand('workbench.action.openSettings');
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
    <header class="toolbar">
      <h1>${TITLE}</h1>
      <div class="toolbar-actions">
        <label title="切换分组模式">分组
          <select id="group-mode">
            <option value="vscode">跟随 VS Code</option>
            <option value="manual">手动分组</option>
            <option value="parentDir">按父目录</option>
            <option value="fileType">按文件类型</option>
          </select>
        </label>
        <label title="切换排序方式">排序
          <select id="sort-mode">
            <option value="none">不排序</option>
            <option value="modifiedAsc">修改时间正序</option>
            <option value="modifiedDesc">修改时间逆序</option>
            <option value="nameAsc">文件名正序</option>
            <option value="nameDesc">文件名逆序</option>
          </select>
        </label>
      </div>
    </header>
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
    const ownGroupIndex = this.findOwnGroupIndex();
    const hasUserTabs = groups.some((group) => group.tabs.some((tab) => !isVerticalTabsPanel(tab)));
    if (ownGroupIndex < 0 || hasUserTabs) {
      return false;
    }
    if (groups.length !== 1 || groups[0]?.tabs.length !== 1 || !isVerticalTabsPanel(groups[0].tabs[0])) {
      const reusableGroup = groups.find((group, index) => index !== ownGroupIndex && group.tabs.length === 0);
      if (!reusableGroup) {
        return false;
      }
      this.emptyRailLayoutOperation = this.restoreUsableEmptyRailLayout(reusableGroup.viewColumn);
      try {
        return await this.emptyRailLayoutOperation;
      } finally {
        this.emptyRailLayoutOperation = undefined;
      }
    }

    this.emptyRailLayoutOperation = this.restoreUsableEmptyRailLayout();
    try {
      return await this.emptyRailLayoutOperation;
    } finally {
      this.emptyRailLayoutOperation = undefined;
    }
  }

  private async restoreUsableEmptyRailLayout(reusableViewColumn?: vscode.ViewColumn): Promise<boolean> {
    const ratio = getEmptyRailRestoreRatio(this.context);
    logInfo('检测到垂直标签栏没有可显示标签，准备恢复右侧编辑器区域', { ratio, reusableViewColumn });
    this.arrangingRail = true;
    try {
      if (reusableViewColumn === undefined) {
        await vscode.commands.executeCommand('workbench.action.newGroupRight');
      } else {
        await focusEditorGroup(reusableViewColumn);
      }
      await openWelcomeEditor();
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
      if (!await applyLeadingRailRatio(ratio)) {
        logWarn('恢复空垂直标签栏宽度失败');
        return false;
      }
      if (!await this.focusAndLockOwnGroup()) {
        return false;
      }
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

function getDefaultRailRatio(): number {
  const configuredRatio = vscode.workspace.getConfiguration('verticalTabs').get<number>('defaultRailWidthRatio', DEFAULT_RAIL_RATIO);
  return normalizeRailRatio(configuredRatio);
}

function getEmptyRailRestoreRatio(context: vscode.ExtensionContext): number {
  const savedRatio = context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY);
  if (typeof savedRatio === 'number' && Number.isFinite(savedRatio) && savedRatio > 0 && savedRatio <= MAX_EMPTY_RAIL_RESTORE_RATIO) {
    return normalizeRailRatio(savedRatio);
  }
  return getDefaultRailRatio();
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

function targetIdentity(tab: vscode.Tab): TabTargetIdentity {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return { kind: 'text', uri: input.uri.toString() };
  if (input instanceof vscode.TabInputTextDiff) return { kind: 'diff', originalUri: input.original.toString(), modifiedUri: input.modified.toString() };
  if (input instanceof vscode.TabInputCustom) return { kind: 'custom', uri: input.uri.toString() };
  if (input instanceof vscode.TabInputNotebook) return { kind: 'notebook', uri: input.uri.toString() };
  if (input instanceof vscode.TabInputNotebookDiff) return { kind: 'notebookDiff', originalUri: input.original.toString(), modifiedUri: input.modified.toString() };
  if (input instanceof vscode.TabInputWebview) return { kind: 'webview', viewType: input.viewType, label: tab.label };
  if (input instanceof vscode.TabInputTerminal) return { kind: 'terminal', label: tab.label };
  return { kind: 'unknown', label: tab.label };
}

function isActivatableTab(tab: vscode.Tab): boolean | undefined {
  return getActivatableBuiltInWebviewTarget(tab) ? true : undefined;
}

function isActivatableTabForCommands(tab: vscode.Tab): boolean {
  const kind = inputKind(tab.input);
  return kind === 'text' || kind === 'diff' || kind === 'custom' || kind === 'notebook' || kind === 'notebookDiff'
    || getActivatableBuiltInWebviewTarget(tab) !== undefined;
}

function getActivatableBuiltInWebviewTarget(tab: vscode.Tab): 'welcome' | 'settings' | undefined {
  if (!(tab.input instanceof vscode.TabInputWebview)) {
    return undefined;
  }
  const viewType = tab.input.viewType.toLowerCase();
  const label = tab.label.toLowerCase();
  if (viewType.includes('welcome')
    || viewType.includes('gettingstarted')
    || label.includes('welcome')
    || label.includes('get started')
    || label === 'welcome'
    || label === 'getting started'
    || label === '欢迎'
    || label.includes('开始')
    || label.includes('入门')) {
    return 'welcome';
  }
  if (viewType.includes('settings')
    || viewType.includes('preferences')
    || label.includes('settings')
    || label === '设置'
    || label.includes('首选项')) {
    return 'settings';
  }
  return undefined;
}

function inputPath(input: vscode.Tab['input']): string | undefined {
  const uri = inputUri(input);
  if (!uri) {
    return undefined;
  }
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative === uri.fsPath ? uri.path : relative;
}

function inputUri(input: vscode.Tab['input']): vscode.Uri | undefined {
  return input instanceof vscode.TabInputText
    || input instanceof vscode.TabInputCustom
    || input instanceof vscode.TabInputNotebook
    ? input.uri
    : input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff
      ? input.modified
      : undefined;
}

async function inputMtime(input: vscode.Tab['input']): Promise<number | undefined> {
  const uri = inputUri(input);
  if (!uri) {
    return undefined;
  }
  try {
    const stat = await withTimeout(vscode.workspace.fs.stat(uri), INPUT_MTIME_TIMEOUT_MS);
    return stat?.mtime;
  } catch {
    return undefined;
  }
}

function defaultManualGroupName(source: vscode.Tab, target: vscode.Tab): string {
  const sourceDir = inputPath(source.input);
  const targetDir = inputPath(target.input);
  if (sourceDir && targetDir) {
    const sourceParent = path.posix.dirname(sourceDir);
    const targetParent = path.posix.dirname(targetDir);
    if (sourceParent === targetParent && sourceParent !== '.') {
      return path.posix.basename(sourceParent);
    }
  }
  return '新分组';
}

function readGroupMode(context: vscode.ExtensionContext): GroupMode {
  const value = context.workspaceState.get<GroupMode>(GROUP_MODE_STORAGE_KEY);
  return value === 'manual' || value === 'parentDir' || value === 'fileType' || value === 'vscode' ? value : 'vscode';
}

function readSortMode(context: vscode.ExtensionContext): SortMode {
  const value = context.workspaceState.get<SortMode>(SORT_MODE_STORAGE_KEY);
  return value === 'modifiedAsc' || value === 'modifiedDesc' || value === 'nameAsc' || value === 'nameDesc' || value === 'none' ? value : 'none';
}

function readManualGroups(context: vscode.ExtensionContext): ManualTabGroup[] {
  const value = context.workspaceState.get<unknown>(MANUAL_GROUPS_STORAGE_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredManualGroup);
}

function readStringMap(context: vscode.ExtensionContext, key: string): Map<string, string> {
  const value = context.workspaceState.get<unknown>(key);
  if (!Array.isArray(value)) return new Map();
  return new Map(value.filter((entry): entry is [string, string] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string'));
}

function readStringArrayMap(context: vscode.ExtensionContext, key: string): Map<string, string[]> {
  const value = context.workspaceState.get<unknown>(key);
  if (!Array.isArray(value)) return new Map();
  return new Map(value.filter((entry): entry is [string, string[]] => Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string')));
}

function isStoredManualGroup(value: unknown): value is ManualTabGroup {
  return typeof value === 'object' && value !== null
    && typeof (value as Partial<ManualTabGroup>).id === 'string'
    && typeof (value as Partial<ManualTabGroup>).name === 'string'
    && typeof (value as Partial<ManualTabGroup>).collapsed === 'boolean';
}

async function focusEditorGroup(viewColumn: vscode.ViewColumn | undefined): Promise<void> {
  const commands: Partial<Record<vscode.ViewColumn, string>> = {
    [vscode.ViewColumn.One]: 'workbench.action.focusFirstEditorGroup',
    [vscode.ViewColumn.Two]: 'workbench.action.focusSecondEditorGroup',
    [vscode.ViewColumn.Three]: 'workbench.action.focusThirdEditorGroup',
    [vscode.ViewColumn.Four]: 'workbench.action.focusFourthEditorGroup',
    [vscode.ViewColumn.Five]: 'workbench.action.focusFifthEditorGroup',
    [vscode.ViewColumn.Six]: 'workbench.action.focusSixthEditorGroup',
    [vscode.ViewColumn.Seven]: 'workbench.action.focusSeventhEditorGroup',
    [vscode.ViewColumn.Eight]: 'workbench.action.focusEighthEditorGroup',
    [vscode.ViewColumn.Nine]: 'workbench.action.focusNinthEditorGroup',
  };
  const command = viewColumn === undefined ? undefined : commands[viewColumn];
  if (!command) {
    return;
  }
  try {
    await vscode.commands.executeCommand(command);
  } catch (error) {
    logDebug('聚焦编辑器组失败，将继续尝试后续操作', { viewColumn, command, error });
  }
}
