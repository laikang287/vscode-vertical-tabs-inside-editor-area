import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  correctMinimizedEditorGroupWidth,
  DEFAULT_RAIL_RATIO,
  getEditorAreaWidth,
  getEditorGroupWidth,
  getObservedRailRatio,
  getRailGroupRatio,
  isEditorLayout,
  normalizeRailRatio,
  resolveRailRatio,
  SAFE_RAIL_WIDTH,
  shouldPersistRailGroupRatio,
  shouldPersistObservedRailWidth,
  VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
  type EditorLayout,
} from '../layout/RailLayout';
import { getStrings, resolveLocale } from '../i18n';
import type { LocaleStrings } from '../i18n/locale';
import { logDebug, logError, logInfo, logTrace, logWarn } from '../logging/extensionLogger';
import { buildSnapshot, identityKey, moveItemsBefore, sameIdentity, selectCloseTargets, selectCloseTargetsForTabs, type SnapshotSourceGroup, type SnapshotSourceTab, type TabInputKind } from '../tabs/TabSnapshot';
import { SingletonPanel } from './SingletonPanel';
import { type ExtensionMessage, type GroupMode, type ManualTabGroup, type SortMode, type TabTarget, type TabTargetIdentity, type VerticalTabsSnapshot, parseWebviewMessage } from './messages';
import { canMoveFilesBetweenDirectories, canReorderTabs, tabDragCapability } from './dragPolicy';

export const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';
const WIDTH_RATIO_STORAGE_KEY = 'verticalTabs.railWidthRatio';
const GROUP_MODE_STORAGE_KEY = 'verticalTabs.groupMode';
const SORT_MODE_STORAGE_KEY = 'verticalTabs.sortMode';
const TOOLBAR_CONTROLS_VISIBLE_STORAGE_KEY = 'verticalTabs.toolbarControlsVisible';
const MANUAL_GROUPS_STORAGE_KEY = 'verticalTabs.manualGroups';
const MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY = 'verticalTabs.manualGroupByIdentity';
const MANUAL_ORDER_BY_GROUP_STORAGE_KEY = 'verticalTabs.manualOrderByGroup';
const PINNED_GROUP_IDS_STORAGE_KEY = 'verticalTabs.pinnedGroupIds';
const MAIN_THREAD_WEBVIEW_PREFIX = 'mainThreadWebview-';
const RAIL_SETTLE_DELAY_MS = 150;
const GROUP_PUBLISH_WAIT_ATTEMPTS = 50;
const GROUP_WAIT_INTERVAL_MS = 10;
const INPUT_MTIME_TIMEOUT_MS = 250;
const INITIAL_HOST_REFRESH_DELAY_MS = 800;
const MAX_EMPTY_RAIL_RESTORE_RATIO = 0.3;
const MAX_AUTO_APPLIED_RAIL_RATIO = 0.3;
const SNAPSHOT_REFRESH_TIMEOUT_MS = 2000;
const WEBVIEW_POST_RETRY_DELAY_MS = 250;
const WEBVIEW_POST_MAX_ATTEMPTS = 8;
const RENDER_ACK_TIMEOUT_MS = 1200;
const RENDER_ACK_MAX_ATTEMPTS = 6;

export class VerticalTabsPanel {
  private static readonly panels = new SingletonPanel<VerticalTabsPanel>();
  private static readonly visibilityEmitter = new vscode.EventEmitter<boolean>();
  private static serializerRegistered = false;
  private static operations: Promise<void> = Promise.resolve();
  private static layoutOperations: Promise<void> = Promise.resolve();
  private static visibilityOperations: Promise<void> = Promise.resolve();

  static readonly onDidChangeVisibility = VerticalTabsPanel.visibilityEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private revision = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private initialHostRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private renderAckTimer: ReturnType<typeof setTimeout> | undefined;
  private minWidthCorrectionTimer: ReturnType<typeof setTimeout> | undefined;
  private renderAckRevision = 0;
  private renderAckAttempts = 0;
  private disposed = false;
  // Ignore the Webview's initial ResizeObserver report until VS Code has
  // finished creating and sizing the dedicated editor group.
  private arrangingRail = true;
  private lastObservedRailWidth: number | undefined;
  private emptyRailLayoutOperation: Promise<boolean> | undefined;
  private suppressScheduledRefresh = false;
  private currentSnapshot: VerticalTabsSnapshot = { revision: 0, groupMode: 'vscode', sortMode: 'none', rememberState: true, toolbarControlsVisible: true, tabs: [], manualGroups: [], displayGroups: [] };
  private groupMode: GroupMode;
  private sortMode: SortMode;
  private toolbarControlsVisible: boolean;
  private readonly manualGroups: ManualTabGroup[];
  private readonly manualGroupByIdentity: Map<string, string>;
  private readonly manualOrderByGroup: Map<string, string[]>;
 private readonly pinnedGroupIds: Set<string>;
  private localeStrings: LocaleStrings;
 private rememberStateEnabled: boolean;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.rememberStateEnabled = shouldRememberState();
    this.groupMode = readGroupMode(context);
    this.sortMode = readSortMode(context);
    this.toolbarControlsVisible = readToolbarControlsVisible(context);
    this.manualGroups = this.rememberStateEnabled ? readManualGroups(context) : [];
    this.manualGroupByIdentity = this.rememberStateEnabled ? readStringMap(context, MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY) : new Map();
    this.manualOrderByGroup = this.rememberStateEnabled ? readStringArrayMap(context, MANUAL_ORDER_BY_GROUP_STORAGE_KEY) : new Map();
    this.pinnedGroupIds = this.rememberStateEnabled ? readStringSet(context, PINNED_GROUP_IDS_STORAGE_KEY) : new Set();
    this.localeStrings = this.resolveUiLocale();
    logInfo('垂直标签面板实例已创建', { viewColumn: panel.viewColumn });
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message).catch((error) => logError('处理 Webview 消息失败', error));
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        void this.handleTabChange(event).catch((error) => logError('处理 VS Code 标签变化失败', error));
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.scheduleRefresh();
        this.scheduleMinimizedWidthCorrection('tabGroupsChanged');
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('verticalTabs')) {
          void this.handleConfigurationChange(event).catch((error) => logError('应用垂直标签配置变更失败', error));
        }
      }),
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
      await existing.reveal(false);
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
        await restored.reveal(false);
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
    await instance?.reveal(false);
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
      (existing) => { void existing.reveal(false); },
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
    await VerticalTabsPanel.enqueueLayout(async () => {
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
    });
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
      if (shouldRememberState()) await this.context.globalState.update(WIDTH_RATIO_STORAGE_KEY, preparedRatio);
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
    if (!shouldRememberState()) {
      logDebug('Skip saving vertical tab width: automatic memory is disabled');
      return;
    }
    if (!this.hasVisibleUserTabs()) {
      logDebug('跳过保存垂直标签栏宽度比例：当前没有可显示的用户标签');
      return;
    }
    const layout = await getEditorLayout();
    let ratio: number | undefined;
    const railGroupRatio = layout ? getRailGroupRatio(layout) : undefined;
    const observedRatio = getObservedRailRatio(layout, this.lastObservedRailWidth);
    logDebug('准备保存垂直标签栏宽度比例', {
      layout,
      tabGroups: describeTabGroups(),
      lastObservedRailWidth: this.lastObservedRailWidth,
      railGroupRatio,
      observedRatio,
      canPersistRailGroupRatio: layout ? shouldPersistRailGroupRatio(layout) : false,
      canPersistObservedRatio: shouldPersistObservedRailWidth(layout, this.lastObservedRailWidth),
    });
    if (layout && shouldPersistRailGroupRatio(layout)) {
      ratio = railGroupRatio;
    } else if (this.lastObservedRailWidth !== undefined) {
      ratio = shouldPersistObservedRailWidth(layout, this.lastObservedRailWidth)
        ? observedRatio
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
    this.disposed = true;
    VerticalTabsPanel.panels.clear(this);
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    if (this.initialHostRefreshTimer) {
      clearTimeout(this.initialHostRefreshTimer);
    }
    if (this.renderAckTimer) {
      clearTimeout(this.renderAckTimer);
    }
    if (this.minWidthCorrectionTimer) {
      clearTimeout(this.minWidthCorrectionTimer);
    }
    queueMicrotask(() => VerticalTabsPanel.syncVisibilityContext());
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private async reveal(preserveFocus: boolean): Promise<void> {
    logTrace('显示垂直标签面板', { viewColumn: this.panel.viewColumn, preserveFocus });
    if (!preserveFocus) {
      await this.correctOwnGroupMinimizedWidth('beforeReveal');
    }
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
    await this.correctOwnGroupMinimizedWidthInLayoutOperation('beforeFocus');
    await focusEditorGroup(ownGroup.viewColumn);
    this.panel.reveal(ownGroup.viewColumn ?? vscode.ViewColumn.One, false);
    await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    return true;
  }

  private scheduleMinimizedWidthCorrection(source: string): void {
    if (this.minWidthCorrectionTimer) clearTimeout(this.minWidthCorrectionTimer);
    this.minWidthCorrectionTimer = setTimeout(() => {
      this.minWidthCorrectionTimer = undefined;
      if (this.disposed || this.arrangingRail) return;
      void this.correctOwnGroupMinimizedWidth(source).catch((error) => logError('检查垂直标签栏最小宽度失败', { source, error }));
    }, GROUP_WAIT_INTERVAL_MS);
  }

  private correctOwnGroupMinimizedWidth(source: string): Promise<boolean> {
    return VerticalTabsPanel.enqueueLayout(() => this.correctOwnGroupMinimizedWidthInLayoutOperation(source));
  }

  private async correctOwnGroupMinimizedWidthInLayoutOperation(source: string): Promise<boolean> {
    const ownGroup = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
    const viewColumn = ownGroup?.viewColumn;
    if (!ownGroup || typeof viewColumn !== 'number' || viewColumn < vscode.ViewColumn.One) {
      logDebug('跳过垂直标签栏最小宽度修正：无法定位插件所属编辑器组', { source, viewColumn });
      return false;
    }

    const layout = await getEditorLayout();
    if (!layout) return false;
    const currentWidth = getEditorGroupWidth(layout, viewColumn);
    if (currentWidth !== VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH) {
      logTrace('垂直标签栏不处于 VS Code 原生最小宽度，无需修正', { source, viewColumn, currentWidth });
      return false;
    }

    const nextLayout = correctMinimizedEditorGroupWidth(layout, viewColumn);
    if (!nextLayout) {
      logWarn('无法安全修正垂直标签栏最小宽度', { source, viewColumn, currentWidth, layout });
      return false;
    }
    logDebug('准备将插件所属编辑器组移出 VS Code 原生最小宽度', {
      source,
      viewColumn,
      previousWidth: currentWidth,
      targetWidth: SAFE_RAIL_WIDTH,
      previousLayout: layout,
      nextLayout,
    });
    if (!await applyEditorLayout(nextLayout)) return false;

    const verifiedLayout = await getEditorLayout();
    const verifiedWidth = verifiedLayout ? getEditorGroupWidth(verifiedLayout, viewColumn) : undefined;
    if (verifiedWidth === undefined || verifiedWidth === VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH) {
      logWarn('垂直标签栏最小宽度修正未生效', { source, viewColumn, verifiedWidth, verifiedLayout });
      return false;
    }
    logInfo('已将插件所属编辑器组从 VS Code 原生最小宽度修正为安全宽度', {
      source,
      viewColumn,
      previousWidth: currentWidth,
      verifiedWidth,
    });
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
    if (this.refreshTimer || this.suppressScheduledRefresh) {
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
    try {
      this.currentSnapshot = await withTimeout(this.createSnapshot(), SNAPSHOT_REFRESH_TIMEOUT_MS);
    } catch (error) {
      logError('刷新垂直标签快照失败，将发送上一份可用快照避免 Webview 停留在加载态', {
        reason: options.reason,
        durationMs: Date.now() - started,
        error,
      });
      this.postMessage({ type: 'renderTabs', title: TITLE, snapshot: this.currentSnapshot });
      this.scheduleRenderAckWatch(this.currentSnapshot);
      return;
    }
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
    this.scheduleRenderAckWatch(this.currentSnapshot);
    if (options.ensureEmptyLayout !== false) {
      void this.ensureUsableEmptyRailLayout().catch((error) => logError('恢复空垂直标签栏布局失败', error));
    }
  }

  private scheduleRenderAckWatch(snapshot: VerticalTabsSnapshot): void {
    if (this.renderAckTimer) {
      clearTimeout(this.renderAckTimer);
    }
    this.renderAckAttempts = 0;
    const revision = snapshot.revision;
    const resend = () => {
      if (this.disposed || VerticalTabsPanel.panels.current !== this || this.renderAckRevision >= revision) {
        return;
      }
      this.renderAckAttempts += 1;
      logWarn('等待 Webview 渲染确认超时，重新发送标签快照', {
        revision,
        attempt: this.renderAckAttempts,
        tabCount: snapshot.tabs.length,
      });
      this.postMessage({ type: 'renderTabs', title: TITLE, snapshot });
      if (this.renderAckAttempts < RENDER_ACK_MAX_ATTEMPTS) {
        this.renderAckTimer = setTimeout(resend, RENDER_ACK_TIMEOUT_MS);
      }
    };
    this.renderAckTimer = setTimeout(resend, RENDER_ACK_TIMEOUT_MS);
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
      tabs: await Promise.all(group.tabs.map((tab) => this.toSnapshotTabSafe(tab))),
    })));
    const snapshot = buildSnapshot(groups, revision, this.manualGroups, {
      localeStrings: this.localeStrings,
      groupMode: this.groupMode,
      sortMode: this.sortMode,
      rememberState: shouldRememberState(),
      toolbarControlsVisible: this.toolbarControlsVisible,
      manualOrderByGroup: this.manualOrderByGroup,
      pinnedGroupIds: this.pinnedGroupIds,
    });
    logDebug('标签快照创建完成', { revision, visibleTabs: snapshot.tabs.length, displayGroups: snapshot.displayGroups.length });
    return snapshot;
  }

  private async handleTabChange(event: vscode.TabChangeEvent): Promise<void> {
    const changedManualState = this.groupMode === 'manual' && this.applyManualGroupLifecycle(event);
    if (changedManualState) {
      await this.persistManualState();
    }
    this.scheduleRefresh();
  }

  private applyManualGroupLifecycle(event: vscode.TabChangeEvent): boolean {
    let changed = false;
    const openedGroupId = undefined;
    for (const tab of event.closed) {
      if (isVerticalTabsPanel(tab)) continue;
      changed = this.clearManualGroupIdentity(targetIdentity(tab)) || changed;
    }
    for (const tab of event.opened) {
      if (isVerticalTabsPanel(tab)) continue;
      const identity = targetIdentity(tab);
      const key = identityKey(identity);
      const previousGroupId = this.manualGroupByIdentity.get(key);
      if (previousGroupId !== openedGroupId) {
        this.setManualGroup(identity, openedGroupId);
        changed = true;
      }
      if (this.sortMode === 'none') {
        changed = this.removeManualOrderKey(key) || changed;
        this.insertManualOrder(openedGroupId ?? '__ungrouped', key, undefined);
        changed = true;
      }
    }
    if (changed) {
      logDebug('已按当前激活标签更新手动分组生命周期', {
        opened: event.opened.length,
        closed: event.closed.length,
        openedGroupId,
      });
    }
    return changed;
  }

  private async toSnapshotTabSafe(tab: vscode.Tab): Promise<SnapshotSourceTab> {
    try {
      return await this.toSnapshotTab(tab);
    } catch (error) {
      logError('转换单个标签快照失败，将以不可跳转标签继续渲染', { label: tab.label, error });
      return {
        label: tab.label || 'Unknown',
        isActive: tab.isActive,
        isFocused: tab.isActive && tab.group.isActive,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isPreview: tab.isPreview,
        inputKind: 'unknown',
        targetIdentity: { kind: 'unknown', label: tab.label || 'Unknown' },
        isActivatable: false,
        isVerticalTabsPanel: isVerticalTabsPanel(tab),
      };
    }
  }

  private async toSnapshotTab(tab: vscode.Tab): Promise<SnapshotSourceTab> {
    const path = inputPath(tab.input);
    return {
      label: tab.label,
      isActive: tab.isActive,
      isFocused: tab.isActive && tab.group.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      inputKind: inputKind(tab.input),
      path,
      tooltipPath: inputTooltipPath(tab.input),
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

    if (message.type === 'renderAck') {
      logDebug('收到 Webview 渲染确认', {
        revision: message.revision,
        currentRevision: this.currentSnapshot.revision,
        attempts: this.renderAckAttempts,
      });
      if (message.revision >= this.renderAckRevision) {
        this.renderAckRevision = message.revision;
        this.renderAckAttempts = 0;
        if (this.renderAckTimer) {
          clearTimeout(this.renderAckTimer);
          this.renderAckTimer = undefined;
        }
      }
      return;
    }

    if (message.type === 'railWidth') {
      this.lastObservedRailWidth = message.width;
      logDebug('观察到垂直标签 Webview 宽度', { width: message.width, arrangingRail: this.arrangingRail });
      if (this.arrangingRail) {
        return;
      }
      if (message.width <= VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH) {
        await this.correctOwnGroupMinimizedWidth('resizeObserver');
        // Never persist the transient native minimum. A successful correction
        // produces a fresh ResizeObserver report for the safe width.
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
      await this.persistGroupMode();
      logInfo('切换垂直标签分组模式', { groupMode: message.groupMode });
      if (message.groupMode === 'vscode') {
        await this.syncVsCodeTabOrder();
      }
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'setSortMode') {
      this.sortMode = message.sortMode;
      await this.persistSortMode();
      logInfo('切换垂直标签排序模式', { sortMode: message.sortMode });
      if (this.groupMode === 'vscode') {
        await this.syncVsCodeTabOrder();
      }
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'setToolbarControlsVisible') {
      this.toolbarControlsVisible = message.visible;
      await this.persistToolbarControlsVisible();
      logInfo('Toggle vertical tabs toolbar controls visibility', { visible: message.visible });
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'requestCreateGroup') {
      if (this.groupMode !== 'manual') {
        logWarn('创建手动标签分组失败：当前不是手动分组模式', { groupMode: this.groupMode });
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: '输入分组名称',
        placeHolder: '分组名称',
        validateInput: (value) => value.trim().length === 0 ? '分组名称不能为空' : value.trim().length > 80 ? '分组名称不能超过 80 个字符' : undefined,
      });
      if (!name?.trim()) {
        logDebug('取消创建手动标签分组');
        return;
      }
      await this.createManualGroup(name);
      return;
    }
    if (message.type === 'createGroup') {
      if (this.groupMode !== 'manual') {
        logWarn('创建手动标签分组失败：当前不是手动分组模式', { groupMode: this.groupMode, name: message.name.trim() });
        return;
      }
      await this.createManualGroup(message.name);
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
    if (message.type === 'deleteGroup' || message.type === 'closeGroup') {
      await this.closeDisplayGroup(message.groupId);
      await this.refresh({ reason: 'operation' });
      return;
    }
    if (message.type === 'pinGroup' || message.type === 'unpinGroup') {
      const displayGroup = this.currentSnapshot.displayGroups.find((group) => group.id === message.groupId);
      if (!displayGroup || !displayGroup.showHeader || displayGroup.mode === 'vscode') {
        logWarn('拒绝无效或不可固定的分组消息', { groupId: message.groupId, groupMode: this.groupMode, displayGroupMode: displayGroup?.mode });
        return;
      }
      if (message.type === 'pinGroup') this.pinnedGroupIds.add(message.groupId);
      else this.pinnedGroupIds.delete(message.groupId);
      await this.persistPinnedGroups();
      await this.refresh({ reason: 'operation' });
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
      const dragCapability = tabDragCapability(this.groupMode, this.sortMode);
      if (dragCapability === 'disabled') {
        logWarn('拒绝当前分组方式下的标签拖拽消息', { groupMode: this.groupMode, sortMode: this.sortMode });
        return;
      }
      const beforeTarget = canReorderTabs(dragCapability) ? message.beforeTarget : undefined;
      if (canMoveFilesBetweenDirectories(dragCapability)) {
        await this.moveParentDirectoryTabs([message.target], message.groupId, beforeTarget);
      } else if (this.groupMode === 'manual') {
        await this.moveManualTab(message.target, message.groupId, beforeTarget);
      } else {
        await this.moveEditorWithinVsCode(message.target, message.groupId, beforeTarget);
      }
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'moveTabs') {
      const dragCapability = tabDragCapability(this.groupMode, this.sortMode);
      if (dragCapability === 'disabled') {
        logWarn('拒绝当前分组方式下的批量标签拖拽消息', { groupMode: this.groupMode, sortMode: this.sortMode, count: message.targets.length });
        return;
      }
      const beforeTarget = canReorderTabs(dragCapability) ? message.beforeTarget : undefined;
      if (canMoveFilesBetweenDirectories(dragCapability)) {
        await this.moveParentDirectoryTabs(message.targets, message.groupId, beforeTarget);
      } else {
        await this.moveTabs(message.targets, message.groupId, beforeTarget);
      }
      await this.refresh({ reason: 'operation' });
      return;
    }


    if (message.type === 'reorderManualGroup') {
      if (this.groupMode !== 'manual' || this.sortMode !== 'none') {
        logWarn('拒绝非手动排序模式下的分组拖拽消息', { groupMode: this.groupMode, sortMode: this.sortMode });
        return;
      }
      const index = this.manualGroups.findIndex((group) => group.id === message.groupId);
      if (index < 0) {
        logWarn('重排手动分组失败：分组不存在', { groupId: message.groupId });
        return;
      }
      const [moved] = this.manualGroups.splice(index, 1);
      const beforeIndex = message.beforeGroupId
        ? this.manualGroups.findIndex((group) => group.id === message.beforeGroupId)
        : -1;
      this.manualGroups.splice(beforeIndex >= 0 ? beforeIndex : this.manualGroups.length, 0, moved);
      await this.persistManualGroups();
      logInfo('重排手动分组', { groupId: message.groupId, beforeGroupId: message.beforeGroupId });
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
        if (this.groupMode === 'vscode') {
          await this.syncVsCodeTabOrder();
        }
      } else {
        logWarn('固定状态切换失败：标签不可可靠激活', { target: message.target });
      }
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'pinTabs' || message.type === 'unpinTabs') {
      await this.setPinnedTabs(message.targets, message.type === 'pinTabs');
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

    if (message.type === 'moveToGroup') {
      await this.moveEditorToVsCodeGroup(message.target, message.groupIndex);
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'activateTab') {
      const tab = this.resolveTab(message.target);
      logDebug('收到标签激活请求', {
        requestId: message.requestId,
        targetRevision: message.target.revision,
        currentRevision: this.currentSnapshot.revision,
        targetGroupIndex: message.target.groupIndex,
        targetTabIndex: message.target.tabIndex,
        targetKind: message.target.identity.kind,
        resolved: tab ? describeTab(tab) : undefined,
      });
      if (tab) {
        this.suppressScheduledRefresh = true;
        await this.activateTab(tab, message.requestId);
        await this.refresh({ reason: 'navigate' });
        this.suppressScheduledRefresh = false;
      } else {
        logWarn('激活标签失败：标签目标已失效', { requestId: message.requestId, target: message.target, groups: describeTabGroups() });
      }
      return;
    }

    if (message.type === 'closeTabs' || message.type === 'closeOthersForTabs' || message.type === 'closeBelowForTabs') {
      const action = message.type === 'closeTabs' ? 'close' : message.type === 'closeOthersForTabs' ? 'closeOthers' : 'closeBelow';
      await this.closeTargets(selectCloseTargetsForTabs(this.currentSnapshot, action, message.targets));
      await this.refresh({ reason: 'navigate' });
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
      const closed = await vscode.window.tabGroups.close(tabs, true);
      if (!closed && tabs.length > 1) {
        logWarn('批量关闭未全部成功，按稳定标签标识逐项重试', { action, selectedTargets: targets.length });
        for (const target of targets) {
          const retryTab = this.resolveTab(target);
          // A false bulk result can mean the user cancelled a dirty-editor
          // prompt. Never prompt for that tab a second time; only retry tabs
          // that can close without another confirmation.
          if (retryTab && !retryTab.isDirty) await vscode.window.tabGroups.close(retryTab, true);
        }
      }
    }
    await this.refresh({ reason: 'navigate' });
  }

  private async handleConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
    const rememberStateEnabled = shouldRememberState();
    const memoryChanged = rememberStateEnabled !== this.rememberStateEnabled;
    this.rememberStateEnabled = rememberStateEnabled;

    if (event.affectsConfiguration('verticalTabs.language')) {
      this.localeStrings = this.resolveUiLocale();
      this.configureWebview();
    }

    if (!rememberStateEnabled && (memoryChanged
      || event.affectsConfiguration('verticalTabs.defaultGroupMode')
      || event.affectsConfiguration('verticalTabs.defaultSortMode')
      || event.affectsConfiguration('verticalTabs.defaultToolbarControlsVisible'))) {
      this.groupMode = readDefaultGroupMode();
      this.sortMode = readDefaultSortMode();
      this.toolbarControlsVisible = readDefaultToolbarControlsVisible();
      this.manualGroups.splice(0, this.manualGroups.length);
      this.manualGroupByIdentity.clear();
      this.manualOrderByGroup.clear();
      this.pinnedGroupIds.clear();
      logInfo('自动记忆关闭，已恢复垂直标签默认状态', { groupMode: this.groupMode, sortMode: this.sortMode });
    } else if (rememberStateEnabled && memoryChanged) {
      // Enabling memory starts from the state currently visible to the user.
      // Overwrite older saved values so disabling memory cannot unexpectedly
      // resurrect a stale layout when the setting is enabled again.
      await Promise.all([
        this.persistGroupMode(),
        this.persistSortMode(),
        this.persistToolbarControlsVisible(),
        this.persistManualState(),
        this.persistPinnedGroups(),
      ]);
      logInfo('自动记忆开启，已保存当前垂直标签状态', { groupMode: this.groupMode, sortMode: this.sortMode });
    }

    if (!rememberStateEnabled && (memoryChanged
      || event.affectsConfiguration('verticalTabs.tabWidthRatio'))) {
      await VerticalTabsPanel.enqueueLayout(() => applyLeadingRailRatio(getDefaultRailRatio()));
    }
    await this.refresh({ reason: 'operation' });
  }

  private async closeTargets(targets: readonly TabTarget[]): Promise<void> {
    const tabs = targets.map((target) => this.resolveTab(target)).filter((tab): tab is vscode.Tab => tab !== undefined);
    logInfo('Execute tab close targets', { selectedTargets: targets.length, resolvedTabs: tabs.length });
    if (tabs.length === 0) return;
    const closed = await vscode.window.tabGroups.close(tabs, true);
    if (!closed && tabs.length > 1) {
      logWarn('Bulk close did not fully succeed; retrying clean tabs one by one', { selectedTargets: targets.length });
      for (const target of targets) {
        const retryTab = this.resolveTab(target);
        if (retryTab && !retryTab.isDirty) await vscode.window.tabGroups.close(retryTab, true);
      }
    }
  }

  private targetsForDisplayGroup(groupId: string): readonly TabTarget[] {
    return this.currentSnapshot.displayGroups.find((group) => group.id === groupId)?.tabs.map((tab) => tab.target) ?? [];
  }

  private async closeDisplayGroup(groupId: string): Promise<void> {
    const displayGroup = this.currentSnapshot.displayGroups.find((group) => group.id === groupId);
    if (!displayGroup) {
      logWarn('关闭标签分组失败：显示分组不存在', { groupId, groupMode: this.groupMode });
      return;
    }

    if (displayGroup.mode === 'vscode') {
      const sourceGroupIndex = displayGroup.tabs[0]?.target.groupIndex;
      const sourceGroup = sourceGroupIndex === undefined ? undefined : vscode.window.tabGroups.all[sourceGroupIndex];
      if (sourceGroup && !sourceGroup.tabs.some((tab) => isVerticalTabsPanel(tab))) {
        logInfo('关闭 VS Code 编辑器分组及其全部标签', { groupId, sourceGroupIndex, tabCount: sourceGroup.tabs.length });
        await vscode.window.tabGroups.close(sourceGroup, true);
      } else {
        await this.closeTargets(displayGroup.tabs.map((tab) => tab.target));
      }
    } else {
      await this.closeTargets(displayGroup.tabs.map((tab) => tab.target));
    }

    const manualGroupIndex = this.manualGroups.findIndex((candidate) => candidate.id === groupId);
    if (manualGroupIndex >= 0) {
      this.manualGroups.splice(manualGroupIndex, 1);
      for (const [key, assignedGroupId] of this.manualGroupByIdentity) {
        if (assignedGroupId === groupId) this.manualGroupByIdentity.delete(key);
      }
      this.manualOrderByGroup.delete(groupId);
      logInfo('关闭标签并删除手动分组', { groupId });
    }

    if (this.pinnedGroupIds.delete(groupId)) {
      logDebug('关闭分组后清理分组固定状态', { groupId });
    }
    await Promise.all([this.persistManualState(), this.persistPinnedGroups()]);
  }

  private async createManualGroup(name: string): Promise<void> {
    const trimmedName = name.trim();
    logInfo('创建手动标签分组', { name: trimmedName });
    this.manualGroups.push({ id: crypto.randomBytes(9).toString('base64url'), name: trimmedName, collapsed: false });
    await this.persistManualGroups();
    await this.refresh({ reason: 'operation' });
  }

  private setManualGroup(identity: TabTargetIdentity, groupId: string | undefined): void {
    const key = identityKey(identity);
    if (groupId) this.manualGroupByIdentity.set(key, groupId);
    else this.manualGroupByIdentity.delete(key);
  }

  private clearManualGroupIdentity(identity: TabTargetIdentity): boolean {
    const key = identityKey(identity);
    const removedGroup = this.manualGroupByIdentity.delete(key);
    const removedOrder = this.removeManualOrderKey(key);
    return removedGroup || removedOrder;
  }

  private removeManualOrderKey(key: string): boolean {
    let changed = false;
    for (const [groupId, order] of this.manualOrderByGroup) {
      if (!order.includes(key)) continue;
      this.manualOrderByGroup.set(groupId, order.filter((candidate) => candidate !== key));
      changed = true;
    }
    return changed;
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
    if (this.sortMode === 'none') {
      const beforeKey = beforeTarget ? identityKey(beforeTarget.identity) : undefined;
      this.insertManualOrder(destinationGroupId, key, beforeKey);
    }
    await this.persistManualState();
    logInfo('手动移动标签完成', { label: tab.label, groupId, reordered: this.sortMode === 'none' });
  }

  private async moveTabs(targets: readonly TabTarget[], groupId: string | undefined, beforeTarget: TabTarget | undefined): Promise<void> {
    if (targets.length === 0) return;
    if (this.groupMode === 'manual') {
      const destinationGroupId = groupId ?? '__ungrouped';
      if (groupId !== undefined && !this.manualGroups.some((group) => group.id === groupId)) {
        logWarn('Multi-select manual move failed: group does not exist', { groupId });
        return;
      }
      const resolvedTabs = targets.map((target) => this.resolveTab(target)).filter((tab): tab is vscode.Tab => tab !== undefined);
      const tabsToMove = this.sortMode === 'none'
        ? resolvedTabs
        : resolvedTabs.filter((tab) => this.currentSnapshot.tabs.find((item) => sameIdentity(item.target.identity, targetIdentity(tab)))?.manualGroupId !== groupId);
      if (tabsToMove.length === 0) {
        logDebug('自动排序下忽略未改变分组的批量标签拖拽', { count: resolvedTabs.length, groupId });
        return;
      }
      const movedKeys = tabsToMove.map((tab) => identityKey(targetIdentity(tab)));
      const movedKeySet = new Set(movedKeys);
      const beforeKey = beforeTarget ? identityKey(beforeTarget.identity) : undefined;
      if (beforeKey && movedKeySet.has(beforeKey)) {
        logDebug('忽略投放到选中标签集合内部的批量移动', { count: resolvedTabs.length, groupId });
        return;
      }
      for (const [storedGroupId, order] of this.manualOrderByGroup) {
        this.manualOrderByGroup.set(storedGroupId, order.filter((key) => !movedKeySet.has(key)));
      }
      for (const tab of tabsToMove) {
        this.setManualGroup(targetIdentity(tab), groupId);
      }
      if (this.sortMode === 'none') {
        const destinationTabs = this.currentSnapshot.displayGroups
          .find((group) => group.id === destinationGroupId)?.tabs
          .map((tab) => identityKey(tab.target.identity)) ?? [];
        this.manualOrderByGroup.set(destinationGroupId, moveItemsBefore(destinationTabs, movedKeys, beforeKey));
      }
      await this.persistManualState();
      logInfo('Moved selected tabs in manual grouping', { count: tabsToMove.length, groupId, reordered: this.sortMode === 'none' });
      return;
    }
    if (beforeTarget && targets.some((target) => sameIdentity(target.identity, beforeTarget.identity) && target.groupIndex === beforeTarget.groupIndex)) {
      logDebug('忽略投放到选中标签集合内部的 VS Code 批量移动', { count: targets.length, groupId });
      return;
    }
    const stableDestination = (beforeTarget ? this.resolveTab(beforeTarget)?.group : undefined)
      ?? this.resolveVsCodeDisplayGroup(groupId)
      ?? this.resolveTab(targets[0])?.group;
    if (!stableDestination) {
      logWarn('跟随 VS Code 模式批量移动失败：目标编辑器组已失效', { count: targets.length, groupId, beforeTarget });
      return;
    }

    const activeIdentity = activeUserTabIdentity();
    const resolvedTabs = targets.map((target) => this.resolveTab(target))
      .filter((tab): tab is vscode.Tab => tab !== undefined && isActivatableTabForCommands(tab));
    const beforeTab = beforeTarget ? this.resolveTab(beforeTarget) : undefined;
    try {
      // Keep one stable destination while transferring every selected tab. Once
      // they are in that group, calculate one final order and synchronize it as
      // a block; issuing an independent before-target move per tab reverses or
      // offsets non-contiguous selections as the earlier moves change indices.
      for (const tab of resolvedTabs) {
        if (tab.group !== stableDestination) {
          await this.activateTab(tab);
          await this.moveActiveEditorToGroup(tab, stableDestination);
        }
      }
      if (this.sortMode !== 'none') {
        logInfo('跟随 VS Code 模式批量标签仅更改分组', { count: resolvedTabs.length, groupId });
        return;
      }
      const destinationTabs = stableDestination.tabs.filter((tab) => !isVerticalTabsPanel(tab));
      const movedTabsInDestination = resolvedTabs.filter((tab) => destinationTabs.includes(tab));
      const desiredTabs = moveItemsBefore(destinationTabs, movedTabsInDestination, beforeTab);
      await this.syncVsCodeGroupTabOrder(stableDestination, desiredTabs);
      logInfo('跟随 VS Code 模式批量移动完成并抵达投放位置', { count: resolvedTabs.length, groupId, beforeTarget });
    } finally {
      await this.restoreActiveTabAfterOrderSync(activeIdentity);
    }
  }

  private async moveParentDirectoryTabs(targets: readonly TabTarget[], destinationGroupId: string | undefined, beforeTarget: TabTarget | undefined): Promise<void> {
    const destinationGroup = destinationGroupId === undefined
      ? undefined
      : this.currentSnapshot.displayGroups.find((group) => group.mode === 'parentDir' && group.id === destinationGroupId);
    if (!destinationGroup) {
      logWarn('父目录分组移动失败：目标目录分组不存在', { destinationGroupId, count: targets.length });
      return;
    }

    const sourceGroups = targets.map((target) => this.findDisplayGroupForTarget(target));
    const allRemainInDestination = sourceGroups.every((group) => group?.id === destinationGroup.id);
    if (allRemainInDestination) {
      // The display group is a folder, not a VS Code editor group. Resolve the
      // real editor group from the selected tab and keep the native order there.
      if (targets.length === 1) {
        await this.moveEditorWithinVsCode(targets[0]!, undefined, beforeTarget);
      } else {
        await this.moveTabs(targets, undefined, beforeTarget);
      }
      return;
    }

    const destinationDirectory = this.parentDirectoryUri(destinationGroup, targets[0]);
    if (!destinationDirectory) {
      logWarn('父目录分组移动失败：无法解析目标目录', { destinationGroupId, count: targets.length });
      return;
    }

    for (const target of targets) {
      const sourceGroup = this.findDisplayGroupForTarget(target);
      if (sourceGroup?.id === destinationGroup.id) continue;
      await this.moveFileToDirectory(target, destinationDirectory, destinationGroup.id);
    }
  }

  private findDisplayGroupForTarget(target: TabTarget): VerticalTabsSnapshot['displayGroups'][number] | undefined {
    return this.currentSnapshot.displayGroups.find((group) => group.tabs.some((tab) => sameIdentity(tab.target.identity, target.identity)
      && tab.target.groupIndex === target.groupIndex));
  }

  private parentDirectoryUri(destinationGroup: VerticalTabsSnapshot['displayGroups'][number], sourceTarget: TabTarget): vscode.Uri | undefined {
    if (destinationGroup.id === '__other') return undefined;
    if (destinationGroup.id === '__root') {
      const source = this.resolveTab(sourceTarget);
      const sourceUri = source ? inputUri(source.input) : undefined;
      return sourceUri ? vscode.workspace.getWorkspaceFolder(sourceUri)?.uri : undefined;
    }
    const representative = destinationGroup.tabs[0] ? this.resolveTab(destinationGroup.tabs[0].target) : undefined;
    const representativeUri = representative ? inputUri(representative.input) : undefined;
    return representativeUri ? representativeUri.with({ path: path.posix.dirname(representativeUri.path) }) : undefined;
  }

  private async moveFileToDirectory(target: TabTarget, destinationDirectory: vscode.Uri, destinationGroupId: string): Promise<void> {
    const tab = this.resolveTab(target);
    const sourceUri = tab ? inputUri(tab.input) : undefined;
    const sourceTabs = sourceUri ? findTabsByResourceUri(sourceUri) : [];
    if (!tab || !sourceUri || sourceUri.scheme === 'untitled' || sourceTabs.some((candidate) => candidate.isDirty)) {
      logWarn('父目录分组移动失败：仅支持已保存且未修改的文件标签', { target, source: tab ? describeTab(tab) : undefined, destinationGroupId });
      return;
    }
    const destinationUri = vscode.Uri.joinPath(destinationDirectory, path.posix.basename(sourceUri.path));
    if (sourceUri.toString() === destinationUri.toString()) return;
    const sourceInput = tab.input;
    const sourceViewColumn = tab.group.viewColumn;
    try {
      const destinationExists = await resourceExists(destinationUri);
      const destinationTabs = findTabsByResourceUri(destinationUri);
      const replacementViewColumn = destinationTabs.find((candidate) => candidate.isActive)?.group.viewColumn
        ?? destinationTabs[0]?.group.viewColumn
        ?? sourceViewColumn;
      if (destinationExists) {
        const confirmed = await this.confirmFileOverwrite(destinationUri, destinationTabs.some((candidate) => candidate.isDirty));
        if (!confirmed) {
          logInfo('用户取消覆盖同名文件', { source: sourceUri.toString(), destination: destinationUri.toString(), destinationGroupId });
          return;
        }
        if (destinationTabs.length > 0) {
          const closed = await vscode.window.tabGroups.close(destinationTabs, true);
          if (!closed || findTabsByResourceUri(destinationUri).length > 0) {
            logWarn('覆盖同名文件已取消：目标标签未能全部关闭', { destination: destinationUri.toString(), destinationGroupId });
            return;
          }
        }
      }
      await vscode.workspace.fs.rename(sourceUri, destinationUri, { overwrite: destinationExists });
      await this.openMovedResource(sourceInput, tab.label, destinationUri, replacementViewColumn);
      if (destinationExists && destinationTabs.length > 0) {
        const openedDestinationTabs = findTabsByResourceUri(destinationUri);
        const replacementTab = openedDestinationTabs.find((candidate) => candidate.group.viewColumn === replacementViewColumn && candidate.isActive)
          ?? openedDestinationTabs.find((candidate) => candidate.group.viewColumn === replacementViewColumn);
        const duplicateTabs = replacementTab ? openedDestinationTabs.filter((candidate) => candidate !== replacementTab) : [];
        if (duplicateTabs.length > 0) {
          await vscode.window.tabGroups.close(duplicateTabs, true);
        }
      }
      const staleSourceTabs = findTabsByResourceUri(sourceUri);
      if (staleSourceTabs.length > 0) {
        await vscode.window.tabGroups.close(staleSourceTabs, true);
      }
      logInfo(destinationExists ? '父目录分组拖拽已覆盖并移动同名文件' : '父目录分组拖拽已移动文件', {
        source: sourceUri.toString(),
        destination: destinationUri.toString(),
        destinationGroupId,
      });
    } catch (error) {
      logWarn('父目录分组移动文件失败', { source: sourceUri.toString(), destination: destinationUri.toString(), destinationGroupId, error });
    }
  }

  private async confirmFileOverwrite(destinationUri: vscode.Uri, destinationDirty: boolean): Promise<boolean> {
    const detail = destinationDirty
      ? '目标文件对应的标签有未保存更改。继续后将关闭目标标签，并用拖拽文件的内容覆盖目标文件。'
      : '继续后将关闭目标文件的现有标签，并用拖拽文件的内容覆盖目标文件。';
    const choice = await vscode.window.showWarningMessage(
      `目标目录已存在同名文件“${path.posix.basename(destinationUri.path)}”，是否覆盖？`,
      { modal: true, detail },
      '覆盖',
      '取消',
    );
    return choice === '覆盖';
  }

  private async openMovedResource(sourceInput: vscode.Tab['input'], label: string, destinationUri: vscode.Uri, viewColumn: vscode.ViewColumn): Promise<void> {
    const options: vscode.TextDocumentShowOptions = { viewColumn, preserveFocus: false };
    if (sourceInput instanceof vscode.TabInputText) {
      await vscode.window.showTextDocument(destinationUri, options);
      return;
    }
    if (sourceInput instanceof vscode.TabInputTextDiff) {
      await vscode.commands.executeCommand('vscode.diff', sourceInput.original, destinationUri, label, options);
      return;
    }
    if (sourceInput instanceof vscode.TabInputCustom) {
      await vscode.commands.executeCommand('vscode.openWith', destinationUri, sourceInput.viewType, options);
      return;
    }
    if (sourceInput instanceof vscode.TabInputNotebook) {
      await vscode.commands.executeCommand('vscode.openWith', destinationUri, sourceInput.notebookType, options);
      return;
    }
    if (sourceInput instanceof vscode.TabInputNotebookDiff) {
      await vscode.commands.executeCommand('vscode.diff', sourceInput.original, destinationUri, label, options);
    }
  }

  private async setPinnedTabs(targets: readonly TabTarget[], pinned: boolean): Promise<void> {
    for (const target of targets) {
      const tab = this.resolveTab(target);
      if (!tab || !isActivatableTabForCommands(tab) || tab.isPinned === pinned) continue;
      await this.activateTab(tab);
      await vscode.commands.executeCommand(pinned ? 'workbench.action.pinEditor' : 'workbench.action.unpinEditor');
    }
    if (this.groupMode === 'vscode') {
      await this.syncVsCodeTabOrder();
    }
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
      await this.persistGroupMode();
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

  private normalizeManualGroupId(groupId: string | undefined): string | undefined {
    return groupId && this.manualGroups.some((group) => group.id === groupId) ? groupId : undefined;
  }

  private async moveEditorWithinVsCode(target: TabTarget, destinationGroupId: string | undefined, beforeTarget: TabTarget | undefined, stableDestination?: vscode.TabGroup): Promise<void> {
    const tab = this.resolveTab(target);
    if (!tab || !isActivatableTabForCommands(tab)) {
      logWarn('跟随 VS Code 模式移动失败：标签不可可靠激活', { target });
      return;
    }
    const beforeTab = beforeTarget ? this.resolveTab(beforeTarget) : undefined;
    const destination = beforeTab?.group ?? stableDestination ?? this.resolveVsCodeDisplayGroup(destinationGroupId) ?? tab.group;
    logInfo('跟随 VS Code 模式移动标签', {
      source: describeTab(tab),
      before: beforeTab ? describeTab(beforeTab) : undefined,
      destinationGroupId,
      target,
      beforeTarget,
    });
    await this.activateTab(tab);
    if (tab.group !== destination) {
      await this.moveActiveEditorToGroup(tab, destination);
    }
    if (this.sortMode !== 'none') {
      logInfo('跟随 VS Code 模式标签仅更改分组', { destinationGroupId });
      return;
    }
    if (!beforeTab) {
      await this.moveActiveEditorToEndOfGroup(targetIdentity(tab));
      return;
    }
    const movedTab = findTabByIdentity(targetIdentity(tab));
    if (movedTab && beforeTab.group === movedTab.group) {
      await this.moveActiveEditorBeforeTarget(targetIdentity(tab), targetIdentity(beforeTab));
    } else {
      logWarn('跟随 VS Code 模式移动失败：无法解析移动后的源标签或目标标签', {
        source: describeTab(tab),
        before: describeTab(beforeTab),
      });
    }
  }

  private resolveVsCodeDisplayGroup(groupId: string | undefined): vscode.TabGroup | undefined {
    if (!groupId) return undefined;
    const displayGroup = this.currentSnapshot.displayGroups.find((group) => group.id === groupId && group.mode === 'vscode');
    const groupIndex = displayGroup?.tabs[0]?.target.groupIndex;
    const group = groupIndex === undefined ? undefined : vscode.window.tabGroups.all[groupIndex];
    return group && !group.tabs.some((tab) => isVerticalTabsPanel(tab)) ? group : undefined;
  }

  private async moveEditorToVsCodeGroup(target: TabTarget, targetGroupIndex: number): Promise<void> {
    const tab = this.resolveTab(target);
    const destination = vscode.window.tabGroups.all[targetGroupIndex];
    if (!tab || !destination || destination.tabs.some((candidate) => isVerticalTabsPanel(candidate)) || tab.group === destination) {
      logWarn('跟随 VS Code 模式移至分组失败：源标签或目标分组无效', {
        target,
        targetGroupIndex,
        source: tab ? describeTab(tab) : undefined,
        destination: describeTabGroup(destination, targetGroupIndex),
      });
      return;
    }
    if (!isActivatableTabForCommands(tab)) {
      logWarn('跟随 VS Code 模式移至分组失败：标签不可可靠激活', { target });
      return;
    }
    logInfo('跟随 VS Code 模式移至分组', { source: describeTab(tab), destination: describeTabGroup(destination, targetGroupIndex) });
    await this.activateTab(tab);
    await this.moveActiveEditorToGroup(tab, destination);
  }

  private async moveActiveEditorToGroup(sourceTab: vscode.Tab, destination: vscode.TabGroup): Promise<void> {
    const source = findTabPosition(sourceTab);
    const groupsBefore = vscode.window.tabGroups.all;
    const groupCountBefore = groupsBefore.length;
    const targetGroupIndex = groupsBefore.indexOf(destination);
    const targetViewColumn = destination.viewColumn;
    if (!source || targetGroupIndex < 0 || targetViewColumn < vscode.ViewColumn.One || destination.tabs.some((tab) => isVerticalTabsPanel(tab))) {
      logWarn('跟随 VS Code 模式移至分组停止：源标签或目标分组位置已失效', { source: describeTabPosition(source), destination: describeTabGroup(destination, targetGroupIndex) });
      return;
    }
    if (source.group === destination) {
      logDebug('跟随 VS Code 模式移至分组完成', { targetGroupIndex, source: describeTabPosition(source) });
      return;
    }

    // moveActiveEditor 的 position 使用 VS Code 的一基 viewColumn，而不是
    // tabGroups.all 的数组下标。两者顺序可能不同，尤其不能假设垂直栏组
    // 一定是编辑器组 1；必须使用目标组自身的 viewColumn 才能保持身份一致。
    await vscode.commands.executeCommand('moveActiveEditor', {
      to: 'position',
      by: 'group',
      value: targetViewColumn,
    });

    const moved = findTabPosition(sourceTab);
    const groupsAfter = vscode.window.tabGroups.all;
    if (groupsAfter.length > groupCountBefore) {
      logError('跟随 VS Code 模式移至分组异常：移动过程中创建了额外编辑器组', {
        beforeGroupCount: groupCountBefore,
        afterGroupCount: groupsAfter.length,
        source: describeTabPosition(moved),
        destination: describeTabGroup(destination, groupsAfter.indexOf(destination)),
      });
      return;
    }
    if (!moved || moved.group !== destination) {
      logWarn('跟随 VS Code 模式移至分组停止：绝对位置移动未抵达目标分组', {
        source: describeTabPosition(moved),
        destination: describeTabGroup(destination, groupsAfter.indexOf(destination)),
      });
      return;
    }
    logDebug('跟随 VS Code 模式移至分组完成', { targetGroupIndex: groupsAfter.indexOf(destination), source: describeTabPosition(moved) });
  }

  private async moveActiveEditorBeforeTarget(sourceIdentity: TabTargetIdentity, beforeIdentity: TabTargetIdentity): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const source = findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), sourceIdentity));
      const before = findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), beforeIdentity));
      if (!source || !before || source.group !== before.group) {
        logWarn('跟随 VS Code 模式移动停止：源标签或目标标签位置已失效', { attempt, source: describeTabPosition(source), before: describeTabPosition(before) });
        return;
      }
      if (source.tabIndex === before.tabIndex - 1) {
        logDebug('跟随 VS Code 模式移动完成', { attempt, sourceIndex: source.tabIndex, beforeIndex: before.tabIndex });
        return;
      }
      const command = source.tabIndex > before.tabIndex
        ? 'workbench.action.moveEditorLeftInGroup'
        : 'workbench.action.moveEditorRightInGroup';
      const previousIndex = source.tabIndex;
      await vscode.commands.executeCommand(command);
      const next = findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), sourceIdentity));
      if (!next || next.group !== source.group || next.tabIndex === previousIndex) {
        logWarn('跟随 VS Code 模式移动停止：移动命令未改变源标签位置', { command, previousIndex, next: describeTabPosition(next) });
        return;
      }
      logDebug('跟随 VS Code 模式移动一步', { command, previousIndex, nextIndex: next.tabIndex, attempt });
    }
    logWarn('跟随 VS Code 模式移动停止：超过最大移动步数', { sourceIdentity, beforeIdentity });
  }

  private async moveActiveEditorToEndOfGroup(sourceIdentity: TabTargetIdentity): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const source = findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), sourceIdentity));
      if (!source) {
        logWarn('跟随 VS Code 模式移动到末尾停止：源标签位置已失效', { attempt, sourceIdentity });
        return;
      }
      if (source.tabIndex === source.group.tabs.length - 1) {
        logDebug('跟随 VS Code 模式移动到末尾完成', { attempt, sourceIndex: source.tabIndex });
        return;
      }
      const previousIndex = source.tabIndex;
      await vscode.commands.executeCommand('workbench.action.moveEditorRightInGroup');
      const next = findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), sourceIdentity));
      if (!next || next.group !== source.group || next.tabIndex === previousIndex) {
        logWarn('跟随 VS Code 模式移动到末尾停止：右移命令未改变源标签位置', { previousIndex, next: describeTabPosition(next) });
        return;
      }
      logDebug('跟随 VS Code 模式向末尾移动一步', { previousIndex, nextIndex: next.tabIndex, attempt });
    }
    logWarn('跟随 VS Code 模式移动到末尾停止：超过最大移动步数', { sourceIdentity });
  }

  private async syncVsCodeTabOrder(): Promise<void> {
    const activeIdentity = this.currentSnapshot.tabs.find((tab) => tab.isActive)?.target.identity ?? activeUserTabIdentity();
    const snapshot = await this.createSnapshot();
    try {
      for (const displayGroup of snapshot.displayGroups) {
        if (displayGroup.mode !== 'vscode' || displayGroup.tabs.length <= 1) {
          continue;
        }
        const group = vscode.window.tabGroups.all[displayGroup.tabs[0]?.target.groupIndex ?? -1];
        if (!group || group.tabs.some((tab) => isVerticalTabsPanel(tab))) {
          continue;
        }
        await this.syncVsCodeGroupOrder(group, displayGroup.tabs.map((tab) => tab.target.identity));
      }
    } finally {
      await this.restoreActiveTabAfterOrderSync(activeIdentity);
    }
  }

  private async restoreActiveTabAfterOrderSync(identity: TabTargetIdentity | undefined): Promise<void> {
    if (!identity) {
      return;
    }
    const activeIdentity = activeUserTabIdentity();
    if (activeIdentity && sameIdentity(activeIdentity, identity)) {
      return;
    }
    const tab = findTabByIdentity(identity);
    if (!tab) {
      logDebug('排序同步后无需恢复活动标签：原标签不存在', { identity });
      return;
    }
    if (!isActivatableTabForCommands(tab)) {
      logDebug('排序同步后无法恢复活动标签：标签不可可靠激活', { target: describeTab(tab) });
      return;
    }
    logDebug('排序同步后恢复原活动标签', { target: describeTab(tab) });
    await this.activateTab(tab, 'restore-active-after-sort');
  }

  private async syncVsCodeGroupOrder(group: vscode.TabGroup, identities: readonly TabTargetIdentity[]): Promise<void> {
    for (let desiredIndex = 0; desiredIndex < identities.length; desiredIndex += 1) {
      const identity = identities[desiredIndex];
      const tab = group.tabs.find((candidate) => sameIdentity(targetIdentity(candidate), identity));
      if (!tab || !isActivatableTabForCommands(tab)) {
        logWarn('同步 VS Code 横向标签顺序时跳过不可移动标签', { desiredIndex, identity });
        continue;
      }
      let currentIndex = group.tabs.indexOf(tab);
      while (currentIndex > desiredIndex) {
        await this.activateTab(tab);
        await vscode.commands.executeCommand('workbench.action.moveEditorLeftInGroup');
        const nextIndex = group.tabs.findIndex((candidate) => sameIdentity(targetIdentity(candidate), identity));
        if (nextIndex < 0 || nextIndex >= currentIndex) {
          logWarn('同步 VS Code 横向标签顺序提前停止：左移命令未改变位置', { label: tab.label, currentIndex, nextIndex, desiredIndex });
          break;
        }
        currentIndex = nextIndex;
      }
    }
  }

  private async syncVsCodeGroupTabOrder(group: vscode.TabGroup, desiredTabs: readonly vscode.Tab[]): Promise<void> {
    for (let desiredIndex = 0; desiredIndex < desiredTabs.length; desiredIndex += 1) {
      const tab = desiredTabs[desiredIndex];
      if (!tab || !isActivatableTabForCommands(tab)) continue;
      let currentIndex = group.tabs.indexOf(tab);
      while (currentIndex > desiredIndex) {
        await this.activateTab(tab);
        await vscode.commands.executeCommand('workbench.action.moveEditorLeftInGroup');
        const nextIndex = group.tabs.indexOf(tab);
        if (nextIndex < 0 || nextIndex >= currentIndex) {
          logWarn('批量拖拽同步 VS Code 标签顺序提前停止：左移命令未改变位置', { label: tab.label, currentIndex, nextIndex, desiredIndex });
          break;
        }
        currentIndex = nextIndex;
      }
    }
  }

  private async persistManualGroups(): Promise<void> {
    if (!shouldRememberState()) return;
    await this.context.workspaceState.update(MANUAL_GROUPS_STORAGE_KEY, this.manualGroups);
  }

  private async persistManualState(): Promise<void> {
    if (!shouldRememberState()) return;
    await Promise.all([
      this.persistManualGroups(),
      this.context.workspaceState.update(MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY, Array.from(this.manualGroupByIdentity.entries())),
      this.context.workspaceState.update(MANUAL_ORDER_BY_GROUP_STORAGE_KEY, Array.from(this.manualOrderByGroup.entries())),
    ]);
  }

  private async persistGroupMode(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(GROUP_MODE_STORAGE_KEY, this.groupMode);
  }

  private async persistSortMode(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(SORT_MODE_STORAGE_KEY, this.sortMode);
  }

  private async persistToolbarControlsVisible(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(TOOLBAR_CONTROLS_VISIBLE_STORAGE_KEY, this.toolbarControlsVisible);
  }

  private async persistPinnedGroups(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(PINNED_GROUP_IDS_STORAGE_KEY, Array.from(this.pinnedGroupIds));
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
    if (target.revision !== this.currentSnapshot.revision) {
      logDebug('标签目标快照版本已变化，按稳定标识重新查找', { targetRevision: target.revision, currentRevision: this.currentSnapshot.revision });
    }
    const indexedGroup = vscode.window.tabGroups.all[target.groupIndex];
    for (const tab of indexedGroup?.tabs ?? []) {
      if (!isVerticalTabsPanel(tab) && sameIdentity(targetIdentity(tab), target.identity)) {
        return tab;
      }
    }
    const identityMatches = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
      .filter((tab) => !isVerticalTabsPanel(tab) && sameIdentity(targetIdentity(tab), target.identity));
    if (identityMatches.length === 1) return identityMatches[0];
    if (identityMatches.length > 1) {
      logWarn('标签目标存在多个相同稳定标识，拒绝猜测其它编辑器组中的目标', { target, matches: identityMatches.map(describeTab) });
      return undefined;
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

  private async activateTab(tab: vscode.Tab, requestId?: string): Promise<void> {
    logDebug('开始激活标签', { requestId, target: describeTab(tab) });
    if (await this.selectExistingTab(tab, requestId)) {
      this.logActivationOutcome(tab, 'existingNavigation', requestId);
      return;
    }

    const options: vscode.TextDocumentShowOptions = { viewColumn: tab.group.viewColumn, preserveFocus: false };
    if (tab.input instanceof vscode.TabInputText) {
      logDebug('使用 showTextDocument 激活文本标签', { requestId, target: describeTab(tab) });
      await vscode.window.showTextDocument(tab.input.uri, options);
      this.logActivationOutcome(tab, 'showTextDocument', requestId);
      return;
    }
    if (tab.input instanceof vscode.TabInputTextDiff || tab.input instanceof vscode.TabInputNotebookDiff) {
      logDebug('使用 vscode.diff 激活 Diff 标签', { requestId, target: describeTab(tab) });
      await vscode.commands.executeCommand('vscode.diff', tab.input.original, tab.input.modified, tab.label, options);
      this.logActivationOutcome(tab, 'vscode.diff', requestId);
      return;
    }
    if (tab.input instanceof vscode.TabInputCustom) {
      logDebug('使用 vscode.openWith 激活 Custom Editor 标签', { requestId, target: describeTab(tab), viewType: tab.input.viewType });
      await vscode.commands.executeCommand('vscode.openWith', tab.input.uri, tab.input.viewType, options);
      this.logActivationOutcome(tab, 'vscode.openWith:custom', requestId);
      return;
    }
    if (tab.input instanceof vscode.TabInputNotebook) {
      logDebug('使用 vscode.openWith 激活 Notebook 标签', { requestId, target: describeTab(tab), notebookType: tab.input.notebookType });
      await vscode.commands.executeCommand('vscode.openWith', tab.input.uri, tab.input.notebookType, options);
      this.logActivationOutcome(tab, 'vscode.openWith:notebook', requestId);
      return;
    }
    const builtInWebviewTarget = getActivatableBuiltInWebviewTarget(tab);
    if (builtInWebviewTarget === 'welcome') {
      logDebug('使用欢迎页命令激活内置 Webview 标签', { requestId, target: describeTab(tab) });
      await focusEditorGroup(tab.group.viewColumn);
      await openWelcomeEditor();
      this.logActivationOutcome(tab, 'openWelcomeEditor', requestId);
      return;
    }
    if (builtInWebviewTarget === 'settings') {
      logDebug('使用设置页命令激活内置 Webview 标签', { requestId, target: describeTab(tab) });
      await focusEditorGroup(tab.group.viewColumn);
      await vscode.commands.executeCommand('workbench.action.openSettings');
      this.logActivationOutcome(tab, 'workbench.action.openSettings', requestId);
      return;
    }
    logWarn('标签类型不支持通过公开 API 激活', { requestId, target: describeTab(tab) });
    this.logActivationOutcome(tab, 'unsupported', requestId);
  }

  private async selectExistingTab(tab: vscode.Tab, requestId?: string): Promise<boolean> {
    const target = findTabPosition(tab);
    if (!target || target.group.viewColumn === undefined) {
      logDebug('无法定位已有标签，跳过内置导航兜底', { requestId, target: describeTab(tab) });
      return false;
    }

    logDebug('准备通过已有标签导航激活目标', {
      requestId,
      target: describeTab(tab),
      groupIndex: target.groupIndex,
      tabIndex: target.tabIndex,
      viewColumn: target.group.viewColumn,
    });
    await focusEditorGroup(target.group.viewColumn);
    if (activeTabMatches(target, tab)) {
      logDebug('聚焦编辑器组后目标标签已处于激活状态', { requestId, target: describeTab(tab) });
      return true;
    }

    if (target.tabIndex >= 0 && target.tabIndex < 9) {
      const command = `workbench.action.openEditorAtIndex${target.tabIndex + 1}`;
      try {
        logDebug('尝试通过索引命令选择已有标签', { requestId, target: describeTab(tab), command });
        await vscode.commands.executeCommand(command);
        if (activeTabMatches(target, tab)) {
          logDebug('通过索引命令选择已有标签', { requestId, target: describeTab(tab), command });
          return true;
        }
        logDebug('索引命令执行后目标标签仍未激活', { requestId, target: describeTab(tab), command, active: describeActiveTab() });
      } catch (error) {
        logDebug('按索引选择已有标签失败，将尝试组内循环导航', { requestId, target: describeTab(tab), command, error });
      }
    }

    logDebug('单次内置导航命令未能选择目标已有标签，将改用对应编辑器 API，避免循环切换中间标签', { requestId, target: describeTab(tab), tabIndex: target.tabIndex, groupIndex: target.groupIndex, active: describeActiveTab() });
    return false;
  }

  private logActivationOutcome(tab: vscode.Tab, method: string, requestId?: string): void {
    const target = findTabPosition(tab);
    const matched = target ? activeTabMatches(target, tab) : false;
    const details = {
      requestId,
      method,
      expected: describeTab(tab),
      active: describeActiveTab(),
      groups: describeTabGroups(),
    };
    if (matched) {
      logDebug('标签激活完成并通过校验', details);
    } else {
      logWarn('标签激活后校验失败：当前活动标签与目标不一致', details);
    }
  }

  private postMessage(message: ExtensionMessage, attempt = 1): void {
    if (this.disposed || VerticalTabsPanel.panels.current !== this) {
      logDebug('跳过向 Webview 发送消息：面板已释放或实例已切换', { type: message.type, attempt });
      return;
    }
    void this.panel.webview.postMessage(message).then((delivered) => {
      if (!delivered) {
        logWarn('向 Webview 发送消息未送达', { type: message.type, attempt });
        if (attempt < WEBVIEW_POST_MAX_ATTEMPTS) {
          setTimeout(() => {
            if (!this.disposed && VerticalTabsPanel.panels.current === this) {
              this.postMessage(message, attempt + 1);
            }
          }, WEBVIEW_POST_RETRY_DELAY_MS);
        }
      }
    }, (error) => {
      logError('向 Webview 发送消息失败', { type: message.type, attempt, error });
      if (attempt < WEBVIEW_POST_MAX_ATTEMPTS) {
        setTimeout(() => {
          if (!this.disposed && VerticalTabsPanel.panels.current === this) {
            this.postMessage(message, attempt + 1);
          }
        }, WEBVIEW_POST_RETRY_DELAY_MS);
      }
    });
  }

  private resolveConfiguredLanguage(): string {
    const configured = vscode.workspace.getConfiguration('verticalTabs').get<string>('language', 'auto');
    return configured?.toLowerCase() === 'auto'
      ? vscode.env.language
      : (configured ?? 'en');
  }

  private resolveUiLocale(): LocaleStrings {
    const locale = this.resolveConfiguredLanguage();
    const resolved = resolveLocale(locale);
    logDebug('解析 UI 语言', { locale, resolved });
    return getStrings(resolved);
  }

  private configureWebview(): void {
    logDebug('配置垂直标签 Webview HTML 与 CSP');
    this.panel.webview.html = this.createHtml();
  }

  private createHtml(): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const styleContent = this.readWebviewStyle();
    const scriptContent = this.readWebviewScript();
    const i18n = this.localeStrings;
    const resolvedLang = this.resolveConfiguredLanguage();

    return `<!DOCTYPE html>
<html lang="${resolvedLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">${styleContent}</style>
  <title>${TITLE}</title>
</head>
<body>
  <main class="vertical-tabs" aria-live="polite">
    <header class="toolbar">
      <div class="toolbar-actions">
        <button id="toggle-toolbar-controls" class="toolbar-icon" type="button" title="" aria-label="">□</button>
        <button id="expand-all" class="toolbar-icon" type="button" title="" aria-label="">⊞</button>
        <button id="collapse-all" class="toolbar-icon" type="button" title="" aria-label="">⊟</button>
      </div>
      <div id="toolbar-controls" class="toolbar-selects">
        <label class="toolbar-field" for="group-mode"><span>${i18n.groupModeLabel}</span><select id="group-mode"><option value="vscode">${i18n.groupModeVscode}</option><option value="manual">${i18n.groupModeManual}</option><option value="parentDir">${i18n.groupModeParentDir}</option><option value="fileType">${i18n.groupModeFileType}</option></select></label>
        <label class="toolbar-field" for="sort-mode"><span>${i18n.sortModeLabel}</span><select id="sort-mode"><option value="none">${i18n.sortModeNone}</option><option value="modifiedAsc">${i18n.sortModeModifiedAsc}</option><option value="modifiedDesc">${i18n.sortModeModifiedDesc}</option><option value="nameAsc">${i18n.sortModeNameAsc}</option><option value="nameDesc">${i18n.sortModeNameDesc}</option></select></label>
      </div>
    </header>
    <p id="description"></p>
    <section id="groups" aria-label="打开的编辑器标签"></section>
  </main>
  <script nonce="${nonce}">window.__i18n = ${JSON.stringify(i18n)};</script>
  <script nonce="${nonce}">${scriptContent}</script>
</body>
</html>`;
  }

  private readWebviewStyle(): string {
    const stylePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vertical-tabs.css').fsPath;
    try {
      const source = fs.readFileSync(stylePath, 'utf8').replace(/<\/style/gi, '<\\/style');
      logDebug('已内联读取 Webview 样式', { stylePath, bytes: source.length });
      return source;
    } catch (error) {
      logError('读取 Webview 样式失败，将使用最小降级样式', { stylePath, error });
      return [
        ':root { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }',
        'body { margin: 0; }',
        '.vertical-tabs { box-sizing: border-box; min-width: 180px; min-height: 100vh; padding: 6px; }',
        '#description { color: var(--vscode-errorForeground, var(--vscode-descriptionForeground)); font-size: 12px; line-height: 1.5; margin: 4px 6px; }',
        '#description::after { content: " Webview 样式加载失败，请查看 Vertical Tabs 输出日志。"; }',
        '.tab-row, .group-header, .toolbar-actions { display: flex; min-width: 0; }',
        '.tab-main { flex: 1; min-width: 0; text-align: left; }',
      ].join('\n');
    }
  }

  private readWebviewScript(): string {
    const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js').fsPath;
    try {
      const source = fs.readFileSync(scriptPath, 'utf8').replace(/<\/script/gi, '<\\/script');
      logDebug('已内联读取 Webview 脚本', { scriptPath, bytes: source.length });
      return source;
    } catch (error) {
      logError('读取 Webview 脚本失败，将显示诊断错误', { scriptPath, error });
      return [
        "const description = document.querySelector('#description');",
        "if (description) description.textContent = '垂直标签脚本加载失败，请查看 Vertical Tabs 输出日志。';",
      ].join('\n');
    }
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
    return VerticalTabsPanel.enqueueLayout(async () => {
      const ratio = getEmptyRailRestoreRatio(this.context);
      logInfo('检测到垂直标签栏没有可显示标签，准备恢复右侧编辑器区域', { ratio, reusableViewColumn });
      this.arrangingRail = true;
      try {
        const currentReusable = reusableViewColumn ?? findReusableEmptyUserGroupColumn(this.findOwnGroupIndex());
        if (currentReusable === undefined) {
          await vscode.commands.executeCommand('workbench.action.newGroupRight');
        } else {
          await focusEditorGroup(currentReusable);
        }
        await openWelcomeEditor();
        await closeExtraEmptyUserGroups(this.findOwnGroupIndex());
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
    });
  }

  private static enqueueLayout<T>(operation: () => Promise<T>): Promise<T> {
    const result = VerticalTabsPanel.layoutOperations.then(operation, operation);
    VerticalTabsPanel.layoutOperations = result.then(() => undefined, () => undefined);
    return result;
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

function findReusableEmptyUserGroupColumn(ownGroupIndex: number): vscode.ViewColumn | undefined {
  return vscode.window.tabGroups.all.find((group, index) => (
    index !== ownGroupIndex && group.tabs.length === 0
  ))?.viewColumn;
}

async function closeExtraEmptyUserGroups(ownGroupIndex: number): Promise<void> {
  const emptyGroups = vscode.window.tabGroups.all.filter((group, index) => (
    index !== ownGroupIndex && group.tabs.length === 0
  ));
  for (const group of emptyGroups) {
    try {
      await vscode.window.tabGroups.close(group, true);
      logDebug('已关闭多余空编辑器组', { viewColumn: group.viewColumn });
    } catch (error) {
      logDebug('关闭多余空编辑器组失败，将继续保留', { viewColumn: group.viewColumn, error });
    }
  }
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

interface TabPosition {
  readonly group: vscode.TabGroup;
  readonly groupIndex: number;
  readonly tabIndex: number;
}

function findTabPosition(tab: vscode.Tab): TabPosition | undefined {
  const exact = findTabPositionBy((candidate) => candidate === tab);
  if (exact) {
    return exact;
  }
  const identity = targetIdentity(tab);
  return findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), identity));
}

function findTabByIdentity(identity: TabTargetIdentity): vscode.Tab | undefined {
  const position = findTabPositionBy((candidate) => sameIdentity(targetIdentity(candidate), identity));
  return position?.group.tabs[position.tabIndex];
}

function activeUserTabIdentity(): TabTargetIdentity | undefined {
  const group = vscode.window.tabGroups.all.find((candidate) => candidate.isActive);
  const tab = group?.activeTab;
  if (!tab || isVerticalTabsPanel(tab)) {
    return undefined;
  }
  return targetIdentity(tab);
}

function findTabPositionBy(predicate: (tab: vscode.Tab) => boolean): TabPosition | undefined {
  const groups = vscode.window.tabGroups.all;
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (!group) {
      continue;
    }
    const tabIndex = group.tabs.findIndex((candidate) => !isVerticalTabsPanel(candidate) && predicate(candidate));
    if (tabIndex >= 0) {
      return { group, groupIndex, tabIndex };
    }
  }
  return undefined;
}

function activeTabMatches(target: TabPosition, tab: vscode.Tab): boolean {
  const group = vscode.window.tabGroups.all[target.groupIndex];
  if (!group || group.viewColumn !== target.group.viewColumn || !group.isActive) {
    return false;
  }
  const activeTab = group.activeTab;
  return activeTab !== undefined
    && group.tabs.indexOf(activeTab) === target.tabIndex
    && sameIdentity(targetIdentity(activeTab), targetIdentity(tab));
}

function describeTab(tab: vscode.Tab): Record<string, unknown> {
  return {
    label: tab.label,
    inputKind: inputKind(tab.input),
    viewColumn: tab.group.viewColumn,
    groupActive: tab.group.isActive,
    tabActive: tab.isActive,
    isDirty: tab.isDirty,
    isPinned: tab.isPinned,
    identity: targetIdentity(tab),
  };
}

function describeActiveTab(): Record<string, unknown> | undefined {
  const group = vscode.window.tabGroups.all.find((candidate) => candidate.isActive);
  const tab = group?.activeTab;
  if (!group || !tab) {
    return undefined;
  }
  return {
    groupIndex: vscode.window.tabGroups.all.indexOf(group),
    viewColumn: group.viewColumn,
    tabIndex: group.tabs.indexOf(tab),
    ...describeTab(tab),
  };
}

function describeTabPosition(position: TabPosition | undefined): Record<string, unknown> | undefined {
  if (!position) {
    return undefined;
  }
  return {
    groupIndex: position.groupIndex,
    viewColumn: position.group.viewColumn,
    tabIndex: position.tabIndex,
    tabCount: position.group.tabs.length,
  };
}

function describeTabGroups(): readonly Record<string, unknown>[] {
  return vscode.window.tabGroups.all.map((group, groupIndex) => ({
    groupIndex,
    viewColumn: group.viewColumn,
    isActive: group.isActive,
    tabCount: group.tabs.length,
    activeTabIndex: group.activeTab ? group.tabs.indexOf(group.activeTab) : undefined,
    labels: group.tabs.map((tab) => tab.label),
  }));
}

function describeTabGroup(group: vscode.TabGroup | undefined, groupIndex: number): Record<string, unknown> | undefined {
  if (!group) {
    return undefined;
  }
  return {
    groupIndex,
    viewColumn: group.viewColumn,
    isActive: group.isActive,
    tabCount: group.tabs.length,
    labels: group.tabs.map((tab) => tab.label),
  };
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
  const savedRatio = shouldRememberState() ? context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY) : undefined;
  const configuredRatio = readConfiguredRailRatio();
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
  const savedRatio = shouldRememberState() ? context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY) : undefined;
  const configuredRatio = readConfiguredRailRatio();
  return clampAutomaticRailRatio(resolveRailRatio(savedRatio, configuredRatio), { savedRatio, configuredRatio, source: 'configured' });
}

function getDefaultRailRatio(): number {
  return normalizeRailRatio(readConfiguredRailRatio());
}

function getEmptyRailRestoreRatio(context: vscode.ExtensionContext): number {
  const savedRatio = shouldRememberState() ? context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY) : undefined;
  if (typeof savedRatio === 'number' && Number.isFinite(savedRatio) && savedRatio > 0 && savedRatio <= MAX_EMPTY_RAIL_RESTORE_RATIO) {
    return clampAutomaticRailRatio(savedRatio, { savedRatio, source: 'emptyRestore' });
  }
  return clampAutomaticRailRatio(getDefaultRailRatio(), { savedRatio, source: 'emptyRestoreFallback' });
}

async function applyLeadingRailRatio(ratio: number): Promise<boolean> {
  const layout = await getEditorLayout();
  if (!layout || layout.orientation !== 0 || layout.groups.length < 2) {
    logWarn('无法在当前布局中调整左侧标签栏宽度', { layout });
    return false;
  }
  const totalWidth = getEditorAreaWidth(layout);
  const normalizedRatio = clampAutomaticRailRatio(ratio, { source: 'applyLeadingRailRatio' });
  const railWidth = Math.max(SAFE_RAIL_WIDTH, Math.ceil(totalWidth * normalizedRatio));
  const existingRailLikeGroup = findExistingRailLikeRootGroup(layout, normalizedRatio);
  logDebug('准备调整左侧标签栏宽度', {
    requestedRatio: ratio,
    normalizedRatio,
    totalWidth,
    railWidth,
    existingRailLikeGroup,
    layout,
    tabGroups: describeTabGroups(),
  });
  if (existingRailLikeGroup !== undefined) {
    logDebug('跳过调整左侧标签栏宽度：当前布局中已有匹配目标比例的小宽度编辑器组', {
      requestedRatio: ratio,
      normalizedRatio,
      existingRailLikeGroup,
      layout,
    });
    return true;
  }
  const siblingWidths = layout.groups.slice(1).map((group) => typeof group.size === 'number' && group.size > 0 ? group.size : 1);
  const siblingTotal = siblingWidths.reduce((sum, size) => sum + size, 0);
  const availableWidth = Math.max(1, totalWidth - railWidth);
  const nextLayout = {
    ...layout,
    groups: [
      { ...layout.groups[0], size: railWidth },
      ...layout.groups.slice(1).map((group, index) => ({
        ...group,
        size: Math.max(1, Math.round(availableWidth * siblingWidths[index] / siblingTotal)),
      })),
    ],
  };
  logDebug('应用左侧标签栏宽度布局', { requestedRatio: ratio, normalizedRatio, previousLayout: layout, nextLayout });
  return applyEditorLayout(nextLayout);
}

function clampAutomaticRailRatio(ratio: number, details: Record<string, unknown>): number {
  const normalized = normalizeRailRatio(ratio);
  const clamped = Math.min(normalized, MAX_AUTO_APPLIED_RAIL_RATIO);
  if (clamped !== normalized) {
    logWarn('自动应用垂直标签栏宽度比例过大，已限制以避免压缩右侧编辑器组', {
      ...details,
      requestedRatio: ratio,
      normalizedRatio: normalized,
      clampedRatio: clamped,
      maxAutoAppliedRailRatio: MAX_AUTO_APPLIED_RAIL_RATIO,
    });
  }
  return clamped;
}

function findExistingRailLikeRootGroup(layout: EditorLayout, ratio: number): { readonly index: number; readonly size: number; readonly ratio: number } | undefined {
  const totalWidth = getEditorAreaWidth(layout);
  if (totalWidth <= 0) {
    return undefined;
  }
  const rootGroups = layout.groups.map((group, index) => ({
    index,
    size: typeof group.size === 'number' && Number.isFinite(group.size) && group.size > 0 ? group.size : undefined,
  }));
  const sizedGroups = rootGroups.filter((group): group is { readonly index: number; readonly size: number } => group.size !== undefined);
  if (sizedGroups.length < 2) {
    return undefined;
  }
  const leading = sizedGroups.find((group) => group.index === 0);
  if (!leading) return undefined;
  const leadingRatio = leading.size / totalWidth;
  // The rail is always the leading root group. Once the user has already made
  // it narrow, preserve that native divider width regardless of how many
  // editor groups share the right side. Requiring one right sibling to occupy
  // most of the window caused multi-column layouts to be reapplied globally.
  if (leadingRatio > MAX_EMPTY_RAIL_RESTORE_RATIO) return undefined;
  return { index: leading.index, size: leading.size, ratio: leadingRatio };
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
    || kind === 'webview' || kind === 'terminal' || kind === 'unknown';
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

function inputTooltipPath(input: vscode.Tab['input']): string | undefined {
  const uri = inputUri(input);
  if (!uri) {
    return undefined;
  }
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
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

function findTabsByResourceUri(uri: vscode.Uri): vscode.Tab[] {
  const key = uri.toString();
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => inputUri(tab.input)?.toString() === key);
}

async function resourceExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return false;
    throw error;
  }
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
  if (!shouldRememberState()) return readDefaultGroupMode();
  const value = context.workspaceState.get<GroupMode>(GROUP_MODE_STORAGE_KEY);
  return isGroupMode(value) ? value : readDefaultGroupMode();
}

function readSortMode(context: vscode.ExtensionContext): SortMode {
  if (!shouldRememberState()) return readDefaultSortMode();
  const value = context.workspaceState.get<SortMode>(SORT_MODE_STORAGE_KEY);
  return isSortMode(value) ? value : readDefaultSortMode();
}

function readToolbarControlsVisible(context: vscode.ExtensionContext): boolean {
  if (!shouldRememberState()) return readDefaultToolbarControlsVisible();
  const value = context.workspaceState.get<boolean>(TOOLBAR_CONTROLS_VISIBLE_STORAGE_KEY);
  return typeof value === 'boolean' ? value : readDefaultToolbarControlsVisible();
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

function readStringSet(context: vscode.ExtensionContext, key: string): Set<string> {
  const value = context.workspaceState.get<unknown>(key);
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item): item is string => typeof item === 'string'));
}

function shouldRememberState(): boolean {
  return vscode.workspace.getConfiguration('verticalTabs').get<boolean>('rememberState', true);
}

function readConfiguredRailRatio(): number {
  const config = vscode.workspace.getConfiguration('verticalTabs');
  return config.get<number>('tabWidthRatio', DEFAULT_RAIL_RATIO);
}

function readDefaultGroupMode(): GroupMode {
  const value = vscode.workspace.getConfiguration('verticalTabs').get<GroupMode>('defaultGroupMode', 'vscode');
  return isGroupMode(value) ? value : 'vscode';
}

function readDefaultSortMode(): SortMode {
  const value = vscode.workspace.getConfiguration('verticalTabs').get<SortMode>('defaultSortMode', 'none');
  return isSortMode(value) ? value : 'none';
}

function readDefaultToolbarControlsVisible(): boolean {
  const value = vscode.workspace.getConfiguration('verticalTabs').get<unknown>('defaultToolbarControlsVisible', true);
  return typeof value === 'boolean' ? value : true;
}

function isGroupMode(value: unknown): value is GroupMode {
  return value === 'manual' || value === 'parentDir' || value === 'fileType' || value === 'vscode';
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'modifiedAsc' || value === 'modifiedDesc' || value === 'nameAsc' || value === 'nameDesc' || value === 'none';
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
