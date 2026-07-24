import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  countLayoutLeaves,
  correctMinimizedEditorGroupWidth,
  DEFAULT_RAIL_RATIO,
  getEditorAreaWidth,
  getEditorGroupWidth,
  getObservedRailRatio,
  getRailGroupRatio,
  getRailRootGroupIndex,
  isEditorLayout,
  normalizeRailRatio,
  insertRailPreservingEditorWidths,
  nudgeNarrowEdgeEditorGroupWidth,
  removeRailRestoringEditorWidths,
  resolveRailRatio,
  SAFE_RAIL_WIDTH,
  selectWidestEditorGroupViewColumn,
  setRailRootGroupWidth,
  shouldPersistRailGroupRatio,
  shouldPersistObservedRailWidth,
  VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
  type EditorLayout,
  type RailPosition,
  type RailWidthContribution,
} from '../layout/RailLayout';
import { format, getStrings, resolveLocale } from '../i18n';
import type { LocaleStrings } from '../i18n/locale';
import { logDebug, logError, logInfo, logTrace, logWarn, showLogs } from '../logging/extensionLogger';
import {
  adjacentDisplayedGroup,
  adjacentDisplayedTabTarget,
  planDisplayedTabMove,
  resolveDisplayedTab,
  selectedDisplayedTabsInAnchorGroup,
  type TabCommandDirection,
} from '../tabs/TabCommands';
import { TabMruTracker } from '../tabs/TabMruTracker';
import {
  classifyTabResourceStatus,
  matchReadonlyPatterns,
  resolveCachedResourceMetadata,
  type ReadonlyPatternMatch,
} from '../tabs/TabResourceStatus';
import { buildSnapshot, displayOrderKey, identityKey, moveItemsBefore, sameIdentity, selectCloseTargets, selectCloseTargetsForTabs, type SnapshotSourceGroup, type SnapshotSourceTab } from '../tabs/TabSnapshot';
import {
  MAX_WORKSET_NAME_LENGTH,
  WORKSETS_STORAGE_KEY,
  normalizeWorksetName,
  parseStoredWorksets,
  selectReplacementCandidates,
  sortWorksets,
  worksetInputKey,
  worksetNamesEqual,
  writeStoredWorksets,
  type StoredWorksetTab,
  type StoredWorksetV1,
  type WorksetRestoreFailure,
  type WorksetRestoreFailureCategory,
  type WorksetTabInput,
} from '../worksets/Worksets';
import { SingletonPanel } from './SingletonPanel';
import { type ExtensionMessage, type GroupMode, type ManualTabGroup, type RelativePathDisplay, type SortMode, type TabInputKind, type TabResourceStatus, type TabTarget, type TabTargetIdentity, type ToolbarPosition, type VerticalTabItem, type VerticalTabsSnapshot, parseWebviewMessage } from './messages';
import { NativeTabMenuProvider } from './NativeTabMenuProvider';
import { canMoveFilesBetweenDirectories, canReorderTabs, tabDragCapability } from './dragPolicy';

export const VIEW_TYPE = 'verticalTabs.editorArea';
const TITLE = 'Vertical Tabs';
const WIDTH_RATIO_STORAGE_KEY = 'verticalTabs.railWidthRatio';
const GROUP_MODE_STORAGE_KEY = 'verticalTabs.groupMode';
const SORT_MODE_STORAGE_KEY = 'verticalTabs.sortMode';
const TOOLBAR_CONTROLS_VISIBLE_STORAGE_KEY = 'verticalTabs.toolbarControlsVisible';
const SEARCH_VISIBLE_STORAGE_KEY = 'verticalTabs.searchVisible';
const SEARCH_GROUPS_STORAGE_KEY = 'verticalTabs.searchGroups';
const MANUAL_GROUPS_STORAGE_KEY = 'verticalTabs.manualGroups';
const MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY = 'verticalTabs.manualGroupByIdentity';
// Keep the legacy storage key so existing manual tab order survives upgrades.
const DISPLAY_ORDER_BY_GROUP_STORAGE_KEY = 'verticalTabs.manualOrderByGroup';
const PINNED_GROUP_IDS_STORAGE_KEY = 'verticalTabs.pinnedGroupIds';
const COLLAPSED_GROUP_KEYS_STORAGE_KEY = 'verticalTabs.collapsedGroupKeys';
const MAIN_THREAD_WEBVIEW_PREFIX = 'mainThreadWebview-';
const POSITION_FOCUS_RESTORE_DELAY_MS = 150;
const GROUP_PUBLISH_WAIT_ATTEMPTS = 50;
const GROUP_WAIT_INTERVAL_MS = 10;
const INPUT_METADATA_TIMEOUT_MS = 250;
const INITIAL_HOST_REFRESH_DELAY_MS = 800;
const MAX_EMPTY_RAIL_RESTORE_RATIO = 0.3;
const MAX_AUTO_APPLIED_RAIL_RATIO = 0.3;
const SNAPSHOT_REFRESH_TIMEOUT_MS = 2000;
const WEBVIEW_POST_RETRY_DELAY_MS = 250;
const WEBVIEW_POST_MAX_ATTEMPTS = 8;
const RENDER_ACK_TIMEOUT_MS = 1200;
const RENDER_ACK_MAX_ATTEMPTS = 6;
const SHORTCUT_RELEASE_SAFETY_TIMEOUT_MS = 30_000;

interface PreparedRailGroup {
  readonly ratio: number;
  readonly viewColumn: vscode.ViewColumn;
  readonly previousLayout?: EditorLayout;
  readonly layoutAppliedBeforePanel: boolean;
}

interface ActiveUserTabRestore {
  readonly identity: TabTargetIdentity;
  readonly userGroupIndex: number;
  readonly tabIndex: number;
  readonly selection?: vscode.Selection;
}

interface ShortcutReleaseNavigationSession {
  readonly id: string;
  readonly origin: TabTarget;
  readonly restore?: ActiveUserTabRestore;
  target: TabTarget;
  timeout: ReturnType<typeof setTimeout>;
}

interface CloseLayoutRestore {
  readonly position: RailPosition;
  readonly editorGroupCount: number;
  readonly contributions: readonly RailWidthContribution[];
}

interface TabResourceMetadata {
  readonly mtime?: number;
  readonly status?: TabResourceStatus;
}

interface ResourceDirectoryWatcher {
  readonly resources: Set<string>;
  readonly disposables: vscode.Disposable[];
}

interface ResolvedWorksetTab {
  readonly stored: StoredWorksetTab;
  readonly input: WorksetTabInput;
  readonly existing?: vscode.Tab;
}

interface WorksetPreflight {
  readonly resolved: readonly ResolvedWorksetTab[];
  readonly failures: readonly WorksetRestoreFailure[];
  readonly closeTabs: readonly vscode.Tab[];
  readonly protectedTabs: readonly vscode.Tab[];
  readonly dirtyTabs: readonly vscode.Tab[];
}

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
  private shortcutNavigationPreparation: Promise<void> | undefined;
  private shortcutNavigationActivationDepth = 0;
  private shortcutReleaseNavigation: ShortcutReleaseNavigationSession | undefined;
  private shortcutReleaseSequence = 0;
  private snapshotGeneration = 0;
  private appliedSnapshotGeneration = -1;
  private renderAckRevision = 0;
  private renderAckAttempts = 0;
  private disposed = false;
  // Ignore the Webview's initial ResizeObserver report until VS Code has
  // finished creating and sizing the dedicated editor group.
  private arrangingRail = true;
  private lastObservedRailWidth: number | undefined;
  private closeLayoutRestore: CloseLayoutRestore | undefined;
  private emptyRailLayoutOperation: Promise<boolean> | undefined;
  private suppressScheduledRefresh = false;
  private suppressMruTracking = false;
  private currentSnapshot: VerticalTabsSnapshot = { revision: 0, groupMode: 'vscode', sortMode: 'none', toolbarPosition: 'top', rememberState: true, toolbarControlsVisible: true, searchVisible: true, searchGroups: false, alwaysFollowActiveTab: true, nativeContextMenuActionsEnabled: true, tabs: [], manualGroups: [], displayGroups: [] };
  private commandSelectedTargets: readonly TabTarget[] = [];
  private groupMode: GroupMode;
  private sortMode: SortMode;
  private toolbarPosition: ToolbarPosition;
  private toolbarControlsVisible: boolean;
  private searchVisible: boolean;
  private searchGroups: boolean;
  private readonly manualGroups: ManualTabGroup[];
  private readonly manualGroupByIdentity: Map<string, string>;
  private readonly displayOrderByGroup: Map<string, string[]>;
  private readonly pinnedGroupIds: Set<string>;
  private readonly collapsedGroupKeys: Set<string>;
  private readonly worksets: StoredWorksetV1[];
  private readonly mruTracker = new TabMruTracker<vscode.Tab>();
  private readonly nativeTabMenuProvider = new NativeTabMenuProvider();
  private readonly resourceDirectoryWatchers = new Map<string, ResourceDirectoryWatcher>();
  private localeStrings: LocaleStrings;
  private rememberStateEnabled: boolean;
  private railPosition: RailPosition;
  private lastFocusedUserGroup: vscode.TabGroup | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel.webview.options = createWebviewOptions(context);
    this.rememberStateEnabled = shouldRememberState();
    this.groupMode = readGroupMode(context);
    this.sortMode = readSortMode(context);
    this.toolbarPosition = readToolbarPosition();
    this.toolbarControlsVisible = readToolbarControlsVisible(context);
    this.searchVisible = readSearchVisible(context);
    this.searchGroups = readSearchGroups(context);
    this.manualGroups = this.rememberStateEnabled ? readManualGroups(context) : [];
    this.manualGroupByIdentity = this.rememberStateEnabled ? readStringMap(context, MANUAL_GROUP_BY_IDENTITY_STORAGE_KEY) : new Map();
    this.displayOrderByGroup = this.rememberStateEnabled ? readStringArrayMap(context, DISPLAY_ORDER_BY_GROUP_STORAGE_KEY) : new Map();
    this.pinnedGroupIds = this.rememberStateEnabled ? readStringSet(context, PINNED_GROUP_IDS_STORAGE_KEY) : new Set();
    this.collapsedGroupKeys = this.rememberStateEnabled ? readStringSet(context, COLLAPSED_GROUP_KEYS_STORAGE_KEY) : new Set();
    this.worksets = parseStoredWorksets(context.workspaceState.get<unknown>(WORKSETS_STORAGE_KEY));
    this.localeStrings = this.resolveUiLocale();
    this.railPosition = readRailPosition();
    logInfo('垂直标签面板实例已创建', { viewColumn: panel.viewColumn, position: this.railPosition });
    this.disposables.push(
      this.nativeTabMenuProvider,
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message).catch((error) => logError('处理 Webview 消息失败', error));
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        void this.handleTabChange(event).catch((error) => logError('处理 VS Code 标签变化失败', error));
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        if (this.shortcutNavigationActivationDepth === 0) {
          const shortcutReleaseFocus = this.shortcutReleaseNavigation !== undefined && this.isOwnGroupActive();
          if (this.shortcutReleaseNavigation && !shortcutReleaseFocus) {
            void this.cancelShortcutReleaseNavigation('tabGroupsChanged', false);
          }
          if (shortcutReleaseFocus) {
            this.scheduleMinimizedWidthCorrection('shortcutReleaseFocus');
            return;
          }
        }
        this.observeFocusedUserTab();
        this.scheduleRefresh();
        this.scheduleMinimizedWidthCorrection('tabGroupsChanged');
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused && this.shortcutReleaseNavigation) {
          void this.cancelShortcutReleaseNavigation('windowBlur', true)
            .catch((error) => logError('VS Code 窗口失焦时取消精准快捷键导航失败', error));
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('verticalTabs')) {
          void this.handleConfigurationChange(event).catch((error) => logError('应用垂直标签配置变更失败', error));
        } else if (affectsReadonlyConfiguration(event)) {
          this.scheduleRefresh();
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
      vscode.window.onDidChangeActiveTextEditor(() => VerticalTabsPanel.panels.current?.handlePossibleActivation()),
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

  static async navigateOnRelease(context: vscode.ExtensionContext, direction: TabCommandDirection, scope: 'group' | 'all'): Promise<void> {
    logDebug('请求在组合键完全释放后导航相邻标签', { direction, scope });
    const instance = VerticalTabsPanel.panels.current ?? await VerticalTabsPanel.open(context);
    await instance?.navigateOnRelease(direction, scope);
  }

  static async moveTab(context: vscode.ExtensionContext, direction: TabCommandDirection, scope: 'tab' | 'group'): Promise<void> {
    logDebug('请求移动活动标签或垂直栏多选标签', { direction, scope });
    const instance = VerticalTabsPanel.panels.current ?? await VerticalTabsPanel.open(context);
    await instance?.moveByCommand(direction, scope);
  }

  static async saveWorkset(context: vscode.ExtensionContext): Promise<void> {
    const instance = VerticalTabsPanel.panels.current ?? await VerticalTabsPanel.open(context);
    await instance?.saveWorksetAsNew();
  }

  static async loadWorkset(context: vscode.ExtensionContext): Promise<void> {
    const instance = VerticalTabsPanel.panels.current ?? await VerticalTabsPanel.open(context);
    await instance?.pickAndLoadWorkset();
  }

  static async manageWorksets(context: vscode.ExtensionContext): Promise<void> {
    const instance = VerticalTabsPanel.panels.current ?? await VerticalTabsPanel.open(context);
    await instance?.showWorksetManager();
  }

  private static async create(context: vscode.ExtensionContext): Promise<VerticalTabsPanel> {
    logInfo('开始创建新的垂直标签面板', { editorGroups: vscode.window.tabGroups.all.length });
    const previouslyActiveEditor = vscode.window.activeTextEditor;
    const position = readRailPosition();
    const preparedRailGroup = await prepareRailGroup(context, position);
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      TITLE,
      {
        viewColumn: preparedRailGroup?.viewColumn ?? (position === 'left' ? vscode.ViewColumn.One : vscode.ViewColumn.Beside),
        preserveFocus: true,
      },
      createWebviewPanelOptions(context),
    );
    logDebug('WebviewPanel 创建完成', {
      viewType: VIEW_TYPE,
      position,
      requestedViewColumn: preparedRailGroup?.viewColumn,
    });
    const instance = VerticalTabsPanel.panels.show(
      () => new VerticalTabsPanel(panel, context),
      (existing) => { void existing.reveal(false); },
    );
    await VerticalTabsPanel.setVisibilityContext(true);
    await instance.settleAndEnsureRail(previouslyActiveEditor, preparedRailGroup);
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

  private async settleAndEnsureRail(
    previousEditor?: vscode.TextEditor,
    preparedRailGroup?: PreparedRailGroup,
  ): Promise<void> {
    await VerticalTabsPanel.enqueueLayout(async () => {
      this.arrangingRail = true;
      logDebug('根据已发布的编辑器组立即安排垂直标签栏', {
        preparedLayout: preparedRailGroup?.previousLayout !== undefined,
        position: this.railPosition,
        previousEditor: previousEditor?.document.uri.toString(),
      });
      if (VerticalTabsPanel.panels.current !== this) {
        logWarn('安排垂直标签栏时面板实例已变化，终止本次操作');
        return;
      }

      try {
        if (await this.ensureRail(previousEditor, preparedRailGroup)) {
          this.arrangingRail = false;
          logInfo('垂直标签栏安排完成', { position: this.railPosition });
          return;
        }
      } catch (error) {
        logError('安排垂直标签栏时发生异常', error);
      }
      logError('垂直标签栏安排失败', { position: this.railPosition });
    });
    if (VerticalTabsPanel.panels.current === this && !this.hasVisibleUserTabs()) {
      await this.ensureUsableEmptyRailLayout();
    }
  }

  private async ensureRail(
    previousEditor?: vscode.TextEditor,
    preparedRailGroup?: PreparedRailGroup,
  ): Promise<boolean> {
    const initialGroupIndex = await this.waitForOwnGroup();
    if (initialGroupIndex < 0) {
      logWarn('未能在编辑器标签中找到垂直标签 Webview');
      return false;
    }
    logDebug('已找到垂直标签 Webview 所在分组', {
      groupIndex: initialGroupIndex,
      groupCount: vscode.window.tabGroups.all.length,
      tabCount: vscode.window.tabGroups.all[initialGroupIndex]?.tabs.length,
      position: this.railPosition,
    });

    const moveResult = await this.moveOwnGroupToPosition(this.railPosition);
    if (!moveResult.success) {
      return false;
    }

    const finalGroup = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
    if (!isGroupAtRailPosition(finalGroup, this.railPosition)) {
      logWarn('垂直标签 Webview 未位于配置的编辑器区域边缘', {
        position: this.railPosition,
        viewColumn: finalGroup?.viewColumn,
        tabGroups: describeTabGroups(),
      });
      return false;
    }
    if (finalGroup.tabs.length !== 1 || !isVerticalTabsPanel(finalGroup.tabs[0])) {
      logWarn('锁定前垂直标签分组状态不符合预期', {
        tabCount: finalGroup.tabs.length,
        containsVerticalTabs: finalGroup.tabs.some((tab) => isVerticalTabsPanel(tab)),
      });
      return false;
    }
    if (preparedRailGroup !== undefined) {
      if (!preparedRailGroup.layoutAppliedBeforePanel) {
        // The pre-display write can be skipped when VS Code has not published
        // the new empty group yet. Keep the proven post-display path as a safe
        // fallback instead of risking an incorrect editor layout.
        await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
        if (!await applyRailRatio(preparedRailGroup.ratio, this.railPosition, preparedRailGroup.previousLayout)) {
          logWarn('无法在创建垂直标签 Webview 后应用宽度比例');
          return false;
        }
      } else {
        logDebug('垂直标签栏宽度已在 Webview 显示前应用，跳过显示后的布局等待和重复写入');
      }
      if (shouldRememberState()) await this.context.globalState.update(WIDTH_RATIO_STORAGE_KEY, preparedRailGroup.ratio);
      logDebug('保存首次使用的垂直标签栏宽度比例', { ratio: preparedRailGroup.ratio });
    } else if (moveResult.moved) {
      const ratioToApply = getConfiguredRailRatio(this.context);
      // VS Code publishes the new group before its native split layout has
      // committed. Wait one event-loop turn, then write the width once.
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
      if (!await applyRailRatio(ratioToApply, this.railPosition)) {
        logWarn('无法在创建垂直标签 Webview 后应用宽度比例');
        return false;
      }
    }
    if (!await this.focusAndLockOwnGroup()) {
      return false;
    }
    logInfo('垂直标签分组已锁定', { position: this.railPosition });
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
    await this.captureCloseLayoutRestore(preparedRailGroup?.previousLayout);
    await this.refresh({ reason: 'ensureRail' });
    return true;
  }

  private async captureCloseLayoutRestore(previousLayout: EditorLayout | undefined): Promise<void> {
    this.closeLayoutRestore = undefined;
    if (!previousLayout || (previousLayout.orientation ?? 0) !== 0) {
      return;
    }
    const currentLayout = await getEditorLayout();
    if (
      !currentLayout
      || currentLayout.orientation !== 0
      || currentLayout.groups.length !== previousLayout.groups.length + 1
    ) {
      return;
    }
    const contributions = describeRailWidthContributions(previousLayout, currentLayout, this.railPosition);
    this.closeLayoutRestore = {
      position: this.railPosition,
      editorGroupCount: previousLayout.groups.length,
      contributions,
    };
    logDebug('记录隐藏垂直标签栏时的编辑器组宽度返还信息', {
      position: this.railPosition,
      editorGroupCount: previousLayout.groups.length,
      contributions,
    });
  }

  private async saveEditorWidthRatio(position: RailPosition = this.railPosition): Promise<void> {
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
    const railGroupRatio = layout ? getRailGroupRatio(layout, position) : undefined;
    const observedRatio = getObservedRailRatio(layout, this.lastObservedRailWidth);
    logDebug('准备保存垂直标签栏宽度比例', {
      position,
      layout,
      tabGroups: describeTabGroups(),
      lastObservedRailWidth: this.lastObservedRailWidth,
      railGroupRatio,
      observedRatio,
      canPersistRailGroupRatio: layout ? shouldPersistRailGroupRatio(layout, position) : false,
      canPersistObservedRatio: shouldPersistObservedRailWidth(layout, this.lastObservedRailWidth, position),
    });
    if (layout && shouldPersistRailGroupRatio(layout, position)) {
      ratio = railGroupRatio;
    } else if (this.lastObservedRailWidth !== undefined) {
      ratio = shouldPersistObservedRailWidth(layout, this.lastObservedRailWidth, position)
        ? observedRatio
        : undefined;
    }
    if (typeof ratio === 'number') {
      const normalizedRatio = normalizeRailRatio(ratio);
      await this.context.globalState.update(WIDTH_RATIO_STORAGE_KEY, normalizedRatio);
      logDebug('保存用户调整后的垂直标签栏宽度比例', { measuredRatio: ratio, savedRatio: normalizedRatio });
    } else {
      logDebug('跳过保存垂直标签栏宽度比例：当前布局没有独立的对侧编辑器区域', { position, layout });
    }
  }

  private hasSettledRail(): boolean {
    const ownGroupIndex = this.findOwnGroupIndex();
    const ownGroup = vscode.window.tabGroups.all[ownGroupIndex];
    return !this.arrangingRail
      && isGroupAtRailPosition(ownGroup, this.railPosition)
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

  private async moveOwnGroupToPosition(
    position: RailPosition,
  ): Promise<{ readonly success: boolean; readonly moved: boolean }> {
    let ownGroupIndex = this.findOwnGroupIndex();
    let moved = false;
    const maxMoves = Math.max(1, vscode.window.tabGroups.all.length);

    for (let attempt = 0; attempt <= maxMoves; attempt += 1) {
      const ownGroup = vscode.window.tabGroups.all[ownGroupIndex];
      if (!ownGroup || !ownGroup.tabs.some((tab) => isVerticalTabsPanel(tab))) {
        logWarn('移动垂直标签分组失败：找不到面板所在分组', { position, attempt });
        return { success: false, moved };
      }
      if (isGroupAtRailPosition(ownGroup, position)) {
        return { success: true, moved };
      }
      if (attempt === maxMoves) {
        break;
      }

      const beforeColumn = ownGroup.viewColumn;
      await focusEditorGroup(beforeColumn);
      this.panel.reveal(beforeColumn, false);
      const command = position === 'left'
        ? 'workbench.action.moveActiveEditorGroupLeft'
        : 'workbench.action.moveActiveEditorGroupRight';
      logDebug('移动垂直标签分组到配置边缘', {
        position,
        command,
        attempt: attempt + 1,
        beforeColumn,
      });
      await vscode.commands.executeCommand(command);
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));

      ownGroupIndex = this.findOwnGroupIndex();
      const nextGroup = vscode.window.tabGroups.all[ownGroupIndex];
      if (!nextGroup || nextGroup.viewColumn === beforeColumn) {
        logWarn('垂直标签分组移动命令未改变位置', {
          position,
          command,
          beforeColumn,
          tabGroups: describeTabGroups(),
        });
        return { success: false, moved };
      }
      moved = true;
    }

    logWarn('垂直标签分组在安全次数内未到达配置边缘', {
      position,
      maxMoves,
      tabGroups: describeTabGroups(),
    });
    return { success: false, moved };
  }

  private dispose(): void {
    logInfo('垂直标签面板实例已释放');
    this.disposed = true;
    this.clearShortcutReleaseNavigation('dispose');
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
    this.disposeResourceDirectoryWatchers();
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
    const activeTabRestore = captureActiveUserTabRestore();
    await VerticalTabsPanel.enqueueLayout(async () => {
      await this.saveEditorWidthRatio();
      const currentLayout = await getEditorLayout();
      const contributions = currentLayout
        && this.closeLayoutRestore?.position === this.railPosition
        && this.closeLayoutRestore.editorGroupCount === currentLayout.groups.length - 1
        ? this.closeLayoutRestore.contributions
        : [];
      const restoredLayout = currentLayout
        ? removeRailRestoringEditorWidths(currentLayout, this.railPosition, contributions)
        : undefined;
      logDebug('准备隐藏垂直标签栏并恢复用户编辑器组宽度', {
        position: this.railPosition,
        contributions,
        currentLayout,
        restoredLayout,
      });

      const group = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
      if (group && group.tabs.length === 1 && isVerticalTabsPanel(group.tabs[0])) {
        try {
          const closed = await vscode.window.tabGroups.close(group, true);
          if (closed) {
            logDebug('已关闭垂直标签专用编辑器分组');
            if (restoredLayout) {
              await waitForEditorLayoutLeafCount(countLayoutLeaves(restoredLayout));
              if (!await applyEditorLayout(restoredLayout)) {
                logWarn('隐藏垂直标签栏后无法恢复用户编辑器组宽度', { restoredLayout });
              } else {
                logInfo('隐藏垂直标签栏后已恢复用户编辑器组宽度', {
                  position: this.railPosition,
                  contributions,
                  restoredLayout,
                });
              }
            }
            if (activeTabRestore) {
              await this.restoreActiveUserTab(activeTabRestore);
            }
          } else {
            logWarn('关闭垂直标签专用编辑器分组未成功');
          }
        } catch (error) {
          // Falling back to panel disposal still removes the extension view.
          logWarn('关闭垂直标签专用编辑器分组失败，将回退到释放面板', error);
        }
      }
    });
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
    this.snapshotGeneration += 1;
    if (this.refreshTimer || this.suppressScheduledRefresh) {
      logTrace('跳过计划刷新：已有刷新定时器');
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh({ reason: 'scheduled' }).catch((error) => logError('刷新垂直标签快照失败', error));
    }, 0);
  }

  private handlePossibleActivation(): void {
    if (this.shortcutNavigationActivationDepth === 0) {
      if (this.shortcutReleaseNavigation) {
        if (this.isOwnGroupActive()) {
          logTrace('忽略精准快捷键会话主动聚焦 Webview 产生的活动编辑器变化');
          return;
        }
        void this.cancelShortcutReleaseNavigation('activeEditorChanged', false);
      }
    }
    this.observeFocusedUserTab();
    this.scheduleRefresh();
  }

  private observeFocusedUserTab(): void {
    if (this.suppressMruTracking) return;
    const activeGroup = vscode.window.tabGroups.all.find((group) => group.isActive);
    const activeTab = activeGroup?.activeTab;
    const focusedUserTab = activeTab && !isVerticalTabsPanel(activeTab) ? activeTab : undefined;
    if (this.mruTracker.observeFocused(focusedUserTab) && focusedUserTab) {
      logTrace('记录聚焦标签的最近使用时间', { target: describeTab(focusedUserTab) });
    }
  }

  private async refresh(options: { readonly reason: string; readonly ensureEmptyLayout?: boolean }): Promise<void> {
    const started = Date.now();
    const sourceGeneration = this.snapshotGeneration;
    logDebug('开始刷新垂直标签快照', {
      reason: options.reason,
      arrangingRail: this.arrangingRail,
      groupCount: vscode.window.tabGroups.all.length,
    });
    try {
      this.currentSnapshot = await withTimeout(this.createSnapshot(), SNAPSHOT_REFRESH_TIMEOUT_MS);
      this.appliedSnapshotGeneration = sourceGeneration;
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

  private updateLastFocusedUserGroup(): void {
    const groups = vscode.window.tabGroups.all;
    const activeUserGroup = groups.find(
      (group) => group.isActive && !group.tabs.some((tab) => isVerticalTabsPanel(tab)),
    );
    if (activeUserGroup) {
      this.lastFocusedUserGroup = activeUserGroup;
      return;
    }
    if (this.lastFocusedUserGroup && groups.includes(this.lastFocusedUserGroup)) return;

    const activeEditorUri = vscode.window.activeTextEditor?.document.uri.toString();
    this.lastFocusedUserGroup = activeEditorUri
      ? groups.find((group) => group.tabs.some(
        (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === activeEditorUri,
      ))
      : undefined;
  }

  private async createSnapshot(): Promise<VerticalTabsSnapshot> {
    this.observeFocusedUserTab();
    this.revision += 1;
    const revision = this.revision;
    this.updateLastFocusedUserGroup();
    logDebug('开始创建标签快照', {
      revision,
      sourceGroups: vscode.window.tabGroups.all.map((group, index) => ({ index, viewColumn: group.viewColumn, tabCount: group.tabs.length })),
    });
    const resourceMetadataCache = new Map<string, Promise<TabResourceMetadata>>();
    const groups: SnapshotSourceGroup[] = await Promise.all(vscode.window.tabGroups.all.map(async (group, index) => ({
      label: `编辑器组 ${index + 1}`,
      viewColumn: group.viewColumn,
      tabs: await Promise.all(group.tabs.map((tab) => this.toSnapshotTabSafe(tab, resourceMetadataCache))),
    })));
    this.reconcileResourceDirectoryWatchers();
    const snapshot = buildSnapshot(groups, revision, this.manualGroups, {
      localeStrings: this.localeStrings,
      groupMode: this.groupMode,
      sortMode: this.sortMode,
      toolbarPosition: this.toolbarPosition,
      rememberState: shouldRememberState(),
      toolbarControlsVisible: this.toolbarControlsVisible,
      searchVisible: this.searchVisible,
      searchGroups: this.searchGroups,
      alwaysFollowActiveTab: readAlwaysFollowActiveTab(),
      nativeContextMenuActionsEnabled: readNativeContextMenuActionsEnabled(),
      relativePathDisplay: readRelativePathDisplay(),
      displayOrderByGroup: this.displayOrderByGroup,
      pinnedGroupIds: this.pinnedGroupIds,
      collapsedGroupKeys: Array.from(this.collapsedGroupKeys),
    });
    logDebug('标签快照创建完成', { revision, visibleTabs: snapshot.tabs.length, displayGroups: snapshot.displayGroups.length });
    return snapshot;
  }

  private async handleTabChange(event: vscode.TabChangeEvent): Promise<void> {
    if (this.shortcutNavigationActivationDepth === 0) {
      const userTabsChanged = [...event.opened, ...event.closed, ...event.changed].some((tab) => !isVerticalTabsPanel(tab));
      if (this.shortcutReleaseNavigation && userTabsChanged) {
        void this.cancelShortcutReleaseNavigation('tabsChanged', this.isOwnGroupActive());
      }
    }
    let changedState = false;
    for (const tab of event.closed) {
      if (isVerticalTabsPanel(tab)) continue;
      changedState = this.clearClosedTabState(targetIdentity(tab)) || changedState;
    }
    if (this.groupMode === 'manual') {
      changedState = this.applyManualGroupLifecycle(event) || changedState;
    }
    if (changedState) {
      await this.persistManualState();
    }
    this.observeFocusedUserTab();
    this.scheduleRefresh();
  }

  private applyManualGroupLifecycle(event: vscode.TabChangeEvent): boolean {
    let changed = false;
    const openedGroupId = undefined;
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
        changed = this.removeManualDisplayOrderKey(key) || changed;
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

  private async toSnapshotTabSafe(
    tab: vscode.Tab,
    resourceMetadataCache: Map<string, Promise<TabResourceMetadata>>,
  ): Promise<SnapshotSourceTab> {
    try {
      return await this.toSnapshotTab(tab, resourceMetadataCache);
    } catch (error) {
      logError('转换单个标签快照失败，将以不可跳转标签继续渲染', { label: tab.label, error });
      return {
        label: tab.label || 'Unknown',
        isActive: tab.isActive,
        isFocused: tab.isActive && (tab.group.isActive || tab.group === this.lastFocusedUserGroup),
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isPreview: tab.isPreview,
        inputKind: 'unknown',
        targetIdentity: { kind: 'unknown', label: tab.label || 'Unknown' },
        isActivatable: false,
        isVerticalTabsPanel: isVerticalTabsPanel(tab),
        lastActivatedAt: this.mruTracker.lastActivatedAt(tab),
      };
    }
  }

  private async toSnapshotTab(
    tab: vscode.Tab,
    resourceMetadataCache: Map<string, Promise<TabResourceMetadata>>,
  ): Promise<SnapshotSourceTab> {
    const path = inputPath(tab.input);
    const kind = inputKind(tab.input);
    const metadata = await this.inputResourceMetadata(tab.input, resourceMetadataCache);
    return {
      label: tab.label,
      isActive: tab.isActive,
      isFocused: tab.isActive && (tab.group.isActive || tab.group === this.lastFocusedUserGroup),
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      inputKind: kind,
      resourceStatus: metadata.status,
      path,
      directoryName: inputDirectoryName(tab.input),
      relativePath: inputWorkspaceRelativePath(tab.input),
      tooltipPath: inputTooltipPath(tab.input),
      uri: inputUri(tab.input)?.toString(),
      mtime: metadata.mtime,
      lastActivatedAt: this.mruTracker.lastActivatedAt(tab),
      targetIdentity: targetIdentity(tab),
      isActivatable: isActivatableTab(tab),
      isVerticalTabsPanel: isVerticalTabsPanel(tab),
      manualGroupId: this.manualGroupByIdentity.get(identityKey(targetIdentity(tab))),
    };
  }

  private inputResourceMetadata(
    input: vscode.Tab['input'],
    cache: Map<string, Promise<TabResourceMetadata>>,
  ): Promise<TabResourceMetadata> {
    const uri = inputUri(input);
    if (!uri) return Promise.resolve({});
    const key = uri.toString();
    return resolveCachedResourceMetadata(cache, key, () => this.readResourceMetadata(uri));
  }

  private async readResourceMetadata(uri: vscode.Uri): Promise<TabResourceMetadata> {
    const schemeWritable = vscode.workspace.fs.isWritableFileSystem(uri.scheme);
    const readonlyPatterns = readonlyPatternMatch(uri);
    const readonlyFromPermissions = uri.scheme === 'file'
      ? vscode.workspace.getConfiguration('files', uri).get<boolean>('readonlyFromPermissions', false)
      : true;

    let stat: vscode.FileStat | undefined;
    let errorCode: string | undefined;
    try {
      stat = await withTimeout(vscode.workspace.fs.stat(uri), INPUT_METADATA_TIMEOUT_MS);
    } catch (error) {
      errorCode = fileSystemErrorCode(error);
    }

    return {
      mtime: stat?.mtime,
      status: classifyTabResourceStatus({
        schemeWritable,
        errorCode,
        readonlyFromPermissions,
        readonlyPermission: stat?.permissions !== undefined
          && (stat.permissions & vscode.FilePermission.Readonly) !== 0,
        readonlyIncluded: readonlyPatterns.included,
        readonlyExcluded: readonlyPatterns.excluded,
      }),
    };
  }

  private reconcileResourceDirectoryWatchers(): void {
    const desired = new Map<string, { readonly parent: vscode.Uri; readonly resources: Set<string> }>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (isVerticalTabsPanel(tab)) continue;
        const uri = inputUri(tab.input);
        if (!uri || vscode.workspace.fs.isWritableFileSystem(uri.scheme) === undefined) continue;
        const parent = resourceParentUri(uri);
        const parentKey = parent.toString();
        const entry = desired.get(parentKey) ?? { parent, resources: new Set<string>() };
        entry.resources.add(resourceWatchKey(uri));
        desired.set(parentKey, entry);
      }
    }

    for (const [key, entry] of this.resourceDirectoryWatchers) {
      if (desired.has(key)) continue;
      disposeAll(entry.disposables);
      this.resourceDirectoryWatchers.delete(key);
    }

    for (const [key, wanted] of desired) {
      const existing = this.resourceDirectoryWatchers.get(key);
      if (existing) {
        existing.resources.clear();
        for (const resource of wanted.resources) existing.resources.add(resource);
        continue;
      }

      try {
        const resources = new Set(wanted.resources);
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(wanted.parent, '*'));
        const shouldRefresh = (changed: vscode.Uri) => {
          if (resources.has(resourceWatchKey(changed))) this.scheduleRefresh();
        };
        const disposables = [
          watcher,
          watcher.onDidCreate(shouldRefresh),
          watcher.onDidChange(shouldRefresh),
          watcher.onDidDelete(shouldRefresh),
        ];
        this.resourceDirectoryWatchers.set(key, { resources, disposables });
      } catch (error) {
        logDebug('无法为标签资源目录创建文件监听器，将依赖现有标签事件刷新', {
          parent: wanted.parent.toString(),
          error,
        });
      }
    }
  }

  private disposeResourceDirectoryWatchers(): void {
    for (const entry of this.resourceDirectoryWatchers.values()) disposeAll(entry.disposables);
    this.resourceDirectoryWatchers.clear();
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

    if (message.type === 'selectionChanged') {
      this.commandSelectedTargets = message.targets;
      logDebug('同步垂直标签多选状态', { count: message.targets.length });
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

    if (message.type === 'shortcutReleaseComplete') {
      await this.completeShortcutReleaseNavigation(message.sessionId);
      return;
    }

    if (message.type === 'shortcutReleaseCancel') {
      await this.cancelShortcutReleaseNavigation(
        `webview:${message.reason}`,
        message.reason !== 'pointer',
        0,
        message.sessionId,
      );
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

    await this.cancelShortcutReleaseNavigation(`webview:${message.type}`, false);

    if (message.type === 'setCollapsedGroups') {
      this.collapsedGroupKeys.clear();
      for (const key of message.keys) this.collapsedGroupKeys.add(key);
      await this.persistCollapsedGroups();
      return;
    }

    if (message.type === 'manageWorksets') {
      await this.showWorksetManager();
      return;
    }

    if (message.type === 'ready' || message.type === 'requestRefresh') {
      if (message.type === 'ready' && this.rememberStateEnabled && message.collapsedGroupKeys && this.collapsedGroupKeys.size === 0) {
        for (const key of message.collapsedGroupKeys) this.collapsedGroupKeys.add(key);
        await this.persistCollapsedGroups();
      }
      if (message.type === 'ready' && this.initialHostRefreshTimer) {
        clearTimeout(this.initialHostRefreshTimer);
        this.initialHostRefreshTimer = undefined;
      }
      logDebug('Webview 请求刷新标签快照', { type: message.type });
      await this.refresh({ reason: message.type });
      return;
    }

    if (message.type === 'requestNativeTabMenu') {
      if (!readNativeContextMenuActionsEnabled()) {
        this.postMessage({ type: 'nativeTabMenu', requestId: message.requestId, entries: [] });
        return;
      }
      const tab = this.resolveTab(message.target);
      const entries = tab
        ? await this.nativeTabMenuProvider.createMenu(tab, this.resolveConfiguredLanguage())
        : [];
      this.postMessage({ type: 'nativeTabMenu', requestId: message.requestId, entries });
      return;
    }

    if (message.type === 'runNativeTabMenuAction') {
      await this.runNativeTabMenuAction(message.actionId, message.target);
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

    if (message.type === 'setSearchVisible') {
      this.searchVisible = message.visible;
      await this.persistSearchVisible();
      logInfo('Toggle vertical tabs search visibility', { visible: message.visible });
      await this.refresh({ reason: 'operation' });
      return;
    }

    if (message.type === 'setSearchGroups') {
      this.searchGroups = message.enabled;
      await this.persistSearchGroups();
      logInfo('Toggle vertical tabs search groups', { enabled: message.enabled });
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
      } else if (this.groupMode === 'fileType') {
        await this.reorderAutomaticGroupTabs([message.target], message.groupId, beforeTarget);
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
      } else if (this.groupMode === 'fileType') {
        await this.reorderAutomaticGroupTabs(message.targets, message.groupId, beforeTarget);
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
        const previousSuppression = this.suppressScheduledRefresh;
        this.suppressScheduledRefresh = true;
        try {
          await this.activateTab(tab, message.requestId);
          await this.refresh({ reason: 'navigate' });
        } finally {
          this.suppressScheduledRefresh = previousSuppression;
        }
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

  private async runNativeTabMenuAction(actionId: string, target: TabTarget): Promise<void> {
    if (!readNativeContextMenuActionsEnabled()) {
      logWarn('拒绝执行已关闭的 VS Code 标签右键菜单操作', { actionId });
      return;
    }
    const action = this.nativeTabMenuProvider.resolveAction(actionId);
    const tab = this.resolveTab(target);
    if (!action || !tab) {
      logWarn('拒绝无效或过期的 VS Code 标签右键菜单操作', { actionId, targetResolved: Boolean(tab) });
      return;
    }
    const uri = inputUri(tab.input);
    try {
      if (isActivatableTabForCommands(tab)) {
        await this.activateTab(tab, `native-menu-${actionId}`);
      }
      const position = findTabPosition(tab);
      const active = position ? activeTabMatches(position, tab) : false;
      if (action.invocation === 'editor' && !active) {
        logWarn('VS Code 标签右键菜单操作已取消：无法可靠激活目标标签', { actionId, command: action.command, target: describeTab(tab) });
        return;
      }
      if (action.invocation === 'resource' && uri) {
        await vscode.commands.executeCommand(action.command, uri);
      } else if (active) {
        await vscode.commands.executeCommand(action.command);
      } else {
        logWarn('VS Code 标签右键菜单操作已取消：目标既无资源地址也未能激活', { actionId, command: action.command, target: describeTab(tab) });
        return;
      }
      logInfo('已调用 VS Code 标签右键菜单操作', { command: action.command, invocation: action.invocation, target: describeTab(tab) });
    } catch (error) {
      logError('调用 VS Code 标签右键菜单操作失败', { command: action.command, target: describeTab(tab), error });
      const chinese = this.resolveConfiguredLanguage().toLowerCase().startsWith('zh');
      void vscode.window.showWarningMessage(chinese
        ? `无法执行标签菜单操作“${action.command}”，详情请查看 Vertical Tabs 输出日志。`
        : `Could not run tab menu action "${action.command}". See the Vertical Tabs output log for details.`);
    } finally {
      await this.refresh({ reason: 'operation' });
    }
  }

  private async handleConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
    await this.cancelShortcutReleaseNavigation('configurationChanged', this.isOwnGroupActive());
    if (event.affectsConfiguration('verticalTabs.position')) {
      await this.handlePositionConfigurationChange();
    }

    const rememberStateEnabled = shouldRememberState();
    const memoryChanged = rememberStateEnabled !== this.rememberStateEnabled;
    this.rememberStateEnabled = rememberStateEnabled;

    if (event.affectsConfiguration('verticalTabs.toolbarPosition')) {
      this.toolbarPosition = readToolbarPosition();
      logInfo('更新垂直标签工具区位置', { toolbarPosition: this.toolbarPosition });
    }

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
      this.displayOrderByGroup.clear();
      this.pinnedGroupIds.clear();
      this.collapsedGroupKeys.clear();
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
        this.persistCollapsedGroups(),
      ]);
      logInfo('自动记忆开启，已保存当前垂直标签状态', { groupMode: this.groupMode, sortMode: this.sortMode });
    }

    if (!rememberStateEnabled && (memoryChanged
      || event.affectsConfiguration('verticalTabs.tabWidthRatio'))) {
      await VerticalTabsPanel.enqueueLayout(() => applyRailRatio(getDefaultRailRatio(), this.railPosition));
    }
    await this.refresh({ reason: 'operation' });
  }

  private async handlePositionConfigurationChange(): Promise<void> {
    const nextPosition = readRailPosition();
    if (nextPosition === this.railPosition) {
      return;
    }

    const previousPosition = this.railPosition;
    const activeTabRestore = captureActiveUserTabRestore();
    await this.saveEditorWidthRatio(previousPosition);
    this.closeLayoutRestore = undefined;
    this.railPosition = nextPosition;
    const moved = await VerticalTabsPanel.enqueueLayout(
      () => this.relocateRail(nextPosition, activeTabRestore),
    );
    if (!moved) {
      void vscode.window.showWarningMessage(
        `Vertical Tabs could not move to the ${nextPosition} side. See the Vertical Tabs output log for details.`,
      );
    }
  }

  private async relocateRail(
    position: RailPosition,
    activeTabRestore: ActiveUserTabRestore | undefined,
  ): Promise<boolean> {
    this.arrangingRail = true;
    let success = false;
    try {
      const moveResult = await this.moveOwnGroupToPosition(position);
      if (!moveResult.success) {
        return false;
      }
      const ratio = getConfiguredRailRatio(this.context);
      if (!await applyRailRatio(ratio, position)) {
        logWarn('垂直标签栏换边后无法恢复宽度', { position, ratio });
        return false;
      }
      if (!await this.focusAndLockOwnGroup()) {
        return false;
      }
      success = true;
      logInfo('垂直标签栏位置配置已即时应用', { position, ratio });
      return true;
    } catch (error) {
      logError('即时移动垂直标签栏失败', { position, error });
      return false;
    } finally {
      if (!success) {
        await this.focusAndLockOwnGroup().catch((error) => {
          logWarn('移动失败后重新锁定垂直标签分组失败', { position, error });
        });
      }
      if (activeTabRestore) {
        // Group movement and setEditorLayout can resolve before VS Code commits
        // the final active-group state. Restore focus after that native settle
        // window so the rail does not reclaim focus a moment later.
        await new Promise<void>((resolve) => setTimeout(resolve, POSITION_FOCUS_RESTORE_DELAY_MS));
        await this.restoreActiveUserTab(activeTabRestore).catch((error) => {
          logWarn('垂直标签栏换边后恢复活动标签失败', { position, error, activeTabRestore });
        });
        await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS * 5));
        const restoredIdentity = activeUserTabIdentity();
        if (!restoredIdentity || !sameIdentity(restoredIdentity, activeTabRestore.identity)) {
          logDebug('原生活动组状态在首次恢复后再次变化，重试恢复活动标签', {
            position,
            expected: activeTabRestore.identity,
            actual: restoredIdentity,
          });
          await this.restoreActiveUserTab(activeTabRestore).catch((error) => {
            logWarn('垂直标签栏换边后二次恢复活动标签失败', { position, error, activeTabRestore });
          });
        }
      }
      this.arrangingRail = false;
    }
  }

  private async restoreActiveUserTab(restore: ActiveUserTabRestore): Promise<void> {
    const tab = findUserTabForRestore(restore);
    if (!tab) {
      logWarn('垂直标签栏布局调整后找不到原活动标签', { restore });
      return;
    }
    if (tab.input instanceof vscode.TabInputText) {
      await vscode.window.showTextDocument(tab.input.uri, {
        viewColumn: tab.group.viewColumn,
        preserveFocus: false,
        ...(restore.selection ? { selection: restore.selection } : {}),
      });
      logDebug('垂直标签栏布局调整后已恢复活动文本标签', { restore, target: describeTab(tab) });
      return;
    }
    await this.activateTab(tab);
  }

  private async saveWorksetAsNew(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: this.localeStrings.saveWorkset,
      prompt: this.localeStrings.worksetNamePrompt,
      placeHolder: this.localeStrings.worksetNamePlaceholder,
      validateInput: (value) => this.validateWorksetName(value),
    });
    if (!name) return;
    const normalizedName = normalizeWorksetName(name);
    const existing = this.worksets.find((candidate) => worksetNamesEqual(candidate.name, normalizedName));
    if (existing) {
      const overwrite = await vscode.window.showWarningMessage(
        format(this.localeStrings.worksetOverwriteConfirm, existing.name),
        { modal: true, detail: format(this.localeStrings.worksetOverwriteDetail, existing.tabs.length) },
        this.localeStrings.overwrite,
      );
      if (overwrite !== this.localeStrings.overwrite) return;
      await this.overwriteWorkset(existing, normalizedName);
      return;
    }
    const workset = this.captureWorkset(normalizedName);
    this.worksets.push(workset);
    await this.persistWorksets();
    void vscode.window.showInformationMessage(format(this.localeStrings.worksetSaved, workset.name, workset.tabs.length));
  }

  private async pickAndLoadWorkset(): Promise<void> {
    const workset = await this.pickWorkset(this.localeStrings.loadWorkset);
    if (workset) await this.restoreWorkset(workset);
  }

  private async showWorksetManager(): Promise<void> {
    type ManagerItem = vscode.QuickPickItem & { readonly itemType: 'create' | 'workset'; readonly workset?: StoredWorksetV1 };
    const items: ManagerItem[] = [{
      label: `$(add) ${this.localeStrings.createWorkset}`,
      description: this.localeStrings.createWorksetDescription,
      itemType: 'create',
    }, ...sortWorksets(this.worksets).map((workset) => ({
      label: `$(archive) ${workset.name}`,
      description: format(this.localeStrings.worksetTabCount, workset.tabs.length),
      detail: format(this.localeStrings.worksetUpdatedAt, new Date(workset.updatedAt).toLocaleString(this.resolveConfiguredLanguage())),
      itemType: 'workset' as const,
      workset,
    }))];
    const selected = await vscode.window.showQuickPick(items, {
      title: this.localeStrings.manageWorksets,
      placeHolder: this.worksets.length === 0 ? this.localeStrings.noWorksets : this.localeStrings.selectWorkset,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected) return;
    if (selected.itemType === 'create') {
      await this.saveWorksetAsNew();
      return;
    }
    if (!selected.workset) return;
    type ActionItem = vscode.QuickPickItem & { readonly action: 'load' | 'overwrite' | 'rename' | 'delete' };
    const action = await vscode.window.showQuickPick<ActionItem>([
      { label: `$(folder-opened) ${this.localeStrings.load}`, action: 'load' },
      { label: `$(save-all) ${this.localeStrings.overwrite}`, action: 'overwrite' },
      { label: `$(edit) ${this.localeStrings.rename}`, action: 'rename' },
      { label: `$(trash) ${this.localeStrings.delete}`, action: 'delete' },
    ], {
      title: selected.workset.name,
      placeHolder: this.localeStrings.selectWorksetAction,
    });
    if (!action) return;
    if (action.action === 'load') {
      await this.restoreWorkset(selected.workset);
      return;
    }
    if (action.action === 'overwrite') {
      const confirmed = await vscode.window.showWarningMessage(
        format(this.localeStrings.worksetOverwriteConfirm, selected.workset.name),
        { modal: true, detail: format(this.localeStrings.worksetOverwriteDetail, selected.workset.tabs.length) },
        this.localeStrings.overwrite,
      );
      if (confirmed === this.localeStrings.overwrite) await this.overwriteWorkset(selected.workset);
      return;
    }
    if (action.action === 'rename') {
      await this.renameWorkset(selected.workset);
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      format(this.localeStrings.worksetDeleteConfirm, selected.workset.name),
      { modal: true, detail: this.localeStrings.worksetDeleteDetail },
      this.localeStrings.delete,
    );
    if (confirmed !== this.localeStrings.delete) return;
    const index = this.worksets.findIndex((candidate) => candidate.id === selected.workset?.id);
    if (index >= 0) this.worksets.splice(index, 1);
    await this.persistWorksets();
    void vscode.window.showInformationMessage(format(this.localeStrings.worksetDeleted, selected.workset.name));
  }

  private async pickWorkset(title: string): Promise<StoredWorksetV1 | undefined> {
    if (this.worksets.length === 0) {
      void vscode.window.showInformationMessage(this.localeStrings.noWorksets);
      return undefined;
    }
    type WorksetItem = vscode.QuickPickItem & { readonly workset: StoredWorksetV1 };
    const selected = await vscode.window.showQuickPick<WorksetItem>(
      sortWorksets(this.worksets).map((workset) => ({
        label: workset.name,
        description: format(this.localeStrings.worksetTabCount, workset.tabs.length),
        detail: format(this.localeStrings.worksetUpdatedAt, new Date(workset.updatedAt).toLocaleString(this.resolveConfiguredLanguage())),
        workset,
      })),
      { title, placeHolder: this.localeStrings.selectWorkset, matchOnDescription: true, matchOnDetail: true },
    );
    return selected?.workset;
  }

  private validateWorksetName(value: string, currentId?: string): string | undefined {
    const name = normalizeWorksetName(value);
    if (!name) return this.localeStrings.worksetNameRequired;
    if (name.length > MAX_WORKSET_NAME_LENGTH) return format(this.localeStrings.worksetNameTooLong, MAX_WORKSET_NAME_LENGTH);
    const duplicate = this.worksets.find((candidate) => candidate.id !== currentId && worksetNamesEqual(candidate.name, name));
    return duplicate ? format(this.localeStrings.worksetNameExists, duplicate.name) : undefined;
  }

  private async renameWorkset(workset: StoredWorksetV1): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: this.localeStrings.renameWorkset,
      value: workset.name,
      prompt: this.localeStrings.worksetNamePrompt,
      validateInput: (value) => this.validateWorksetName(value, workset.id),
    });
    if (!name) return;
    const index = this.worksets.findIndex((candidate) => candidate.id === workset.id);
    if (index < 0) return;
    const normalizedName = normalizeWorksetName(name);
    this.worksets[index] = { ...workset, name: normalizedName, updatedAt: Date.now() };
    await this.persistWorksets();
    void vscode.window.showInformationMessage(format(this.localeStrings.worksetRenamed, normalizedName));
  }

  private async overwriteWorkset(workset: StoredWorksetV1, name = workset.name): Promise<void> {
    const index = this.worksets.findIndex((candidate) => candidate.id === workset.id);
    if (index < 0) return;
    const replacement = this.captureWorkset(name, workset);
    this.worksets[index] = replacement;
    await this.persistWorksets();
    void vscode.window.showInformationMessage(format(this.localeStrings.worksetOverwritten, replacement.name, replacement.tabs.length));
  }

  private async persistWorksets(): Promise<void> {
    await writeStoredWorksets(this.context.workspaceState, this.worksets);
  }

  private captureWorkset(name: string, existing?: StoredWorksetV1): StoredWorksetV1 {
    const groups = userEditorGroups();
    const tabs: StoredWorksetTab[] = [];
    const entryIdsByIdentity = new Map<string, string[]>();
    let activeTabId: string | undefined;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const userTabs = group.tabs.filter((tab) => !isVerticalTabsPanel(tab));
      for (let tabIndex = 0; tabIndex < userTabs.length; tabIndex += 1) {
        const tab = userTabs[tabIndex];
        const id = crypto.randomBytes(9).toString('base64url');
        const identity = targetIdentity(tab);
        const resource = inputUri(tab.input);
        const folder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
        tabs.push({
          id,
          label: tab.label,
          input: worksetInputFromTab(tab),
          groupIndex,
          tabIndex,
          isPinned: tab.isPinned,
          wasDirty: tab.isDirty,
          manualGroupId: this.manualGroupByIdentity.get(identityKey(identity)),
          ...(folder ? { workspaceFolderUri: folder.uri.toString(), workspaceFolderName: folder.name } : {}),
        });
        const key = identityKey(identity);
        entryIdsByIdentity.set(key, [...(entryIdsByIdentity.get(key) ?? []), id]);
        if (tab.isActive && group.isActive) activeTabId = id;
      }
    }
    const manualOrderByGroup = Array.from(this.displayOrderByGroup.entries()).map(([groupId, order]) => [
      groupId,
      order.flatMap((key) => entryIdsByIdentity.get(key)?.slice(0, 1) ?? []),
    ] as const);
    const now = Date.now();
    return {
      schemaVersion: 1,
      id: existing?.id ?? crypto.randomBytes(9).toString('base64url'),
      name: normalizeWorksetName(name),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      groupCount: groups.length,
      groupMode: this.groupMode,
      sortMode: this.sortMode,
      tabs,
      manualGroups: this.manualGroups.map((group) => ({ ...group })),
      manualOrderByGroup,
      pinnedGroupIds: Array.from(this.pinnedGroupIds),
      collapsedGroupKeys: Array.from(this.collapsedGroupKeys),
      ...(activeTabId ? { activeTabId } : {}),
    };
  }

  private async restoreWorkset(workset: StoredWorksetV1): Promise<void> {
    const preflight = await this.preflightWorkset(workset);
    if (workset.tabs.length > 0 && preflight.resolved.length === 0) {
      await this.showWorksetRestoreReport(workset, 0, preflight.failures);
      return;
    }
    if (!await this.confirmWorksetRestore(workset, preflight)) return;
    const failures = [...preflight.failures];
    const restoredById = new Map<string, vscode.Tab>();
    this.suppressScheduledRefresh = true;
    this.suppressMruTracking = true;
    try {
      const targetGroupCount = Math.max(1, workset.groupCount);
      let groups = await this.ensureWorksetEditorGroups(targetGroupCount);
      for (const candidate of [...preflight.resolved].sort((left, right) =>
        left.stored.groupIndex - right.stored.groupIndex || left.stored.tabIndex - right.stored.tabIndex)) {
        groups = userEditorGroups();
        const destination = groups[Math.min(candidate.stored.groupIndex, groups.length - 1)];
        if (!destination) {
          failures.push({ category: 'openFailed', label: candidate.stored.label, detail: this.localeStrings.worksetEditorGroupUnavailable });
          continue;
        }
        try {
          const restored = candidate.existing
            ? await this.moveExistingWorksetTab(candidate.existing, destination)
            : await this.openWorksetTab(candidate.input, candidate.stored.label, destination);
          if (restored) restoredById.set(candidate.stored.id, restored);
          else failures.push({ category: 'openFailed', label: candidate.stored.label, detail: this.localeStrings.worksetOpenDidNotCreateTab });
        } catch (error) {
          failures.push({ category: isPermissionError(error) ? 'permission' : 'openFailed', label: candidate.stored.label, detail: errorMessage(error) });
        }
      }
      const staleTabs = preflight.closeTabs.filter((tab) => findTabPosition(tab) !== undefined);
      if (staleTabs.length > 0) await vscode.window.tabGroups.close(staleTabs, true);
      await this.applyRestoredPinnedState(workset, restoredById);
      await this.applyRestoredTabOrder(workset, restoredById);
      this.applyRestoredPresentationState(workset, restoredById);
      await Promise.all([
        this.persistGroupMode(),
        this.persistSortMode(),
        this.persistManualState(),
        this.persistPinnedGroups(),
        this.persistCollapsedGroups(),
      ]);
      failures.push(...await this.closeExtraWorksetGroups(targetGroupCount));
      const active = workset.activeTabId ? restoredById.get(workset.activeTabId) : undefined;
      if (active) await this.activateTab(active, 'workset-active');
      await this.settleAndEnsureRail();
    } finally {
      this.suppressMruTracking = false;
      this.suppressScheduledRefresh = false;
      await this.refresh({ reason: 'worksetRestore' });
    }
    await this.showWorksetRestoreReport(workset, restoredById.size, failures);
  }

  private async preflightWorkset(workset: StoredWorksetV1): Promise<WorksetPreflight> {
    const currentTabs = userEditorGroups().flatMap((group) => group.tabs.filter((tab) => !isVerticalTabsPanel(tab)));
    const replacement = selectReplacementCandidates(
      currentTabs.map((tab) => ({ key: worksetInputKey(worksetInputFromTab(tab)), isDirty: tab.isDirty, isPinned: tab.isPinned })),
      workset.tabs.map((tab) => worksetInputKey(tab.input)),
    );
    const unused = new Set(currentTabs);
    const resolved: ResolvedWorksetTab[] = [];
    const failures: WorksetRestoreFailure[] = [];
    for (const stored of [...workset.tabs].sort((left, right) => left.groupIndex - right.groupIndex || left.tabIndex - right.tabIndex)) {
      const expectedKey = worksetInputKey(stored.input);
      const matching = Array.from(unused).filter((tab) => worksetInputKey(worksetInputFromTab(tab)) === expectedKey);
      const existing = matching.find((tab) => userEditorGroups().indexOf(tab.group) === stored.groupIndex) ?? matching[0];
      if (existing) {
        unused.delete(existing);
        resolved.push({ stored, input: stored.input, existing });
        continue;
      }
      const result = await this.resolveStoredWorksetInput(stored);
      if ('failure' in result) failures.push(result.failure);
      else resolved.push({ stored, input: result.input });
    }
    return {
      resolved,
      failures,
      closeTabs: replacement.closeIndexes.map((index) => currentTabs[index]),
      protectedTabs: replacement.protectedIndexes.map((index) => currentTabs[index]),
      dirtyTabs: currentTabs.filter((tab) => tab.isDirty),
    };
  }

  private async confirmWorksetRestore(workset: StoredWorksetV1, preflight: WorksetPreflight): Promise<boolean> {
    const currentTabs = userEditorGroups().flatMap((group) => group.tabs).filter((tab) => !isVerticalTabsPanel(tab));
    if (currentTabs.length === 0 && this.manualGroups.length === 0) return true;
    const detail: string[] = [
      format(this.localeStrings.worksetRestoreCloseCount, preflight.closeTabs.length),
      format(this.localeStrings.worksetRestoreProtectedCount, preflight.protectedTabs.length),
    ];
    if (preflight.dirtyTabs.length > 0) {
      detail.push('', this.localeStrings.worksetAffectedUnsaved);
      detail.push(...preflight.dirtyTabs.map((tab) =>
        `• ${tab.label} — ${inputTooltipPath(tab.input) ?? format(this.localeStrings.editorGroup, userEditorGroups().indexOf(tab.group) + 1)}`));
    }
    if (preflight.failures.length > 0) detail.push('', format(this.localeStrings.worksetPreflightFailures, preflight.failures.length));
    const confirmed = await vscode.window.showWarningMessage(
      format(this.localeStrings.worksetLoadConfirm, workset.name),
      { modal: true, detail: detail.join('\n') },
      this.localeStrings.load,
    );
    return confirmed === this.localeStrings.load;
  }

  private async resolveStoredWorksetInput(
    stored: StoredWorksetTab,
  ): Promise<{ readonly input: WorksetTabInput } | { readonly failure: WorksetRestoreFailure }> {
    const input = stored.input;
    if (input.kind === 'terminal' || input.kind === 'unknown' || (input.kind === 'webview' && !input.builtIn)) {
      return { failure: { category: 'unsupported', label: stored.label, detail: this.localeStrings.worksetUnsupportedTab } };
    }
    if (input.kind === 'webview') return { input };
    if (input.kind === 'text' || input.kind === 'custom' || input.kind === 'notebook') {
      const resolved = await this.resolveWorksetUri(input.uri, stored);
      if ('failure' in resolved) return { failure: { ...resolved.failure, label: stored.label } };
      return { input: { ...input, uri: resolved.uri } };
    }
    const original = await this.resolveWorksetUri(input.originalUri, stored);
    if ('failure' in original) return { failure: { ...original.failure, label: stored.label } };
    const modified = await this.resolveWorksetUri(input.modifiedUri, stored);
    if ('failure' in modified) return { failure: { ...modified.failure, label: stored.label } };
    return { input: { ...input, originalUri: original.uri, modifiedUri: modified.uri } };
  }

  private async resolveWorksetUri(
    raw: string,
    stored: StoredWorksetTab,
  ): Promise<{ readonly uri: string } | { readonly failure: Omit<WorksetRestoreFailure, 'label'> }> {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(raw, true);
    } catch (error) {
      return { failure: { category: 'notFound', detail: errorMessage(error) } };
    }
    if (uri.scheme === 'untitled') return { failure: { category: 'unsupported', detail: this.localeStrings.worksetUntitledUnavailable } };
    if (uri.scheme !== 'file') return { uri: uri.toString() };
    try {
      await vscode.workspace.fs.stat(uri);
      return { uri: uri.toString() };
    } catch (error) {
      if (isPermissionError(error)) return { failure: { category: 'permission', detail: uri.fsPath } };
      if (!isFileNotFoundError(error)) return { failure: { category: 'notFound', detail: `${uri.fsPath}: ${errorMessage(error)}` } };
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    const folder = folders.find((candidate) => candidate.uri.toString() === stored.workspaceFolderUri)
      ?? folders.find((candidate) => stored.workspaceFolderName !== undefined && candidate.name === stored.workspaceFolderName)
      ?? vscode.workspace.getWorkspaceFolder(uri);
    if (!folder && stored.workspaceFolderUri) {
      return { failure: { category: 'notFound', detail: format(this.localeStrings.worksetWorkspaceUnavailable, stored.workspaceFolderName ?? stored.workspaceFolderUri) } };
    }
    const basename = path.posix.basename(uri.path);
    if (!folder || !basename) return { failure: { category: 'deleted', detail: uri.fsPath } };
    try {
      const candidates = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, `**/${escapeGlobSegment(basename)}`), undefined, 3);
      if (candidates.length === 1) return { uri: candidates[0].toString() };
      if (candidates.length === 0) return { failure: { category: 'deleted', detail: uri.fsPath } };
      return { failure: { category: 'moved', detail: format(this.localeStrings.worksetAmbiguousCandidates, uri.fsPath, candidates.length) } };
    } catch (error) {
      return {
        failure: {
          category: isPermissionError(error) ? 'permission' : 'notFound',
          detail: `${uri.fsPath}: ${errorMessage(error)}`,
        },
      };
    }
  }

  private async ensureWorksetEditorGroups(count: number): Promise<vscode.TabGroup[]> {
    await this.ensureUsableEmptyRailLayout();
    for (let attempt = 0; userEditorGroups().length < count && attempt < count + 8; attempt += 1) {
      const groups = userEditorGroups();
      const anchor = groups[groups.length - 1];
      if (anchor?.viewColumn !== undefined) await focusEditorGroup(anchor.viewColumn);
      await vscode.commands.executeCommand('workbench.action.newGroupRight');
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
    }
    return userEditorGroups();
  }

  private async moveExistingWorksetTab(tab: vscode.Tab, destination: vscode.TabGroup): Promise<vscode.Tab | undefined> {
    const input = worksetInputFromTab(tab);
    if (tab.group !== destination) {
      const source = findTabPosition(tab);
      await this.activateTab(tab, 'workset-move');
      if (!source || !activeTabMatches(source, tab)) {
        throw new Error(this.localeStrings.worksetExistingTabActivationFailed);
      }
      await this.moveActiveEditorToGroup(tab, destination);
    }
    return findMatchingTabInGroup(destination, input) ?? tab;
  }

  private async openWorksetTab(input: WorksetTabInput, label: string, destination: vscode.TabGroup): Promise<vscode.Tab | undefined> {
    const viewColumn = destination.viewColumn;
    const options: vscode.TextDocumentShowOptions = { viewColumn, preserveFocus: true, preview: false };
    if (input.kind === 'text') {
      await vscode.window.showTextDocument(vscode.Uri.parse(input.uri, true), options);
    } else if (input.kind === 'diff' || input.kind === 'notebookDiff') {
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.parse(input.originalUri, true), vscode.Uri.parse(input.modifiedUri, true), label, options);
    } else if (input.kind === 'custom') {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(input.uri, true), input.viewType, options);
    } else if (input.kind === 'notebook') {
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(input.uri, true), input.notebookType, options);
    } else if (input.kind === 'webview' && input.builtIn) {
      await focusEditorGroup(viewColumn);
      if (input.builtIn === 'welcome') await openWelcomeEditor();
      else await vscode.commands.executeCommand('workbench.action.openSettings');
    } else {
      return undefined;
    }
    return this.waitForWorksetTab(input, destination);
  }

  private async waitForWorksetTab(input: WorksetTabInput, destination: vscode.TabGroup): Promise<vscode.Tab | undefined> {
    for (let attempt = 0; attempt < GROUP_PUBLISH_WAIT_ATTEMPTS; attempt += 1) {
      const match = findMatchingTabInGroup(destination, input);
      if (match) return match;
      if (input.kind === 'webview' && destination.activeTab && !isVerticalTabsPanel(destination.activeTab)) return destination.activeTab;
      await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
    }
    return undefined;
  }

  private async applyRestoredPinnedState(workset: StoredWorksetV1, restoredById: ReadonlyMap<string, vscode.Tab>): Promise<void> {
    for (const stored of workset.tabs) {
      const tab = restoredById.get(stored.id);
      if (!tab || tab.isPinned === stored.isPinned || !isActivatableTabForCommands(tab)) continue;
      await this.activateTab(tab, 'workset-pin');
      await vscode.commands.executeCommand(stored.isPinned ? 'workbench.action.pinEditor' : 'workbench.action.unpinEditor');
    }
  }

  private async applyRestoredTabOrder(workset: StoredWorksetV1, restoredById: ReadonlyMap<string, vscode.Tab>): Promise<void> {
    for (let groupIndex = 0; groupIndex < Math.max(1, workset.groupCount); groupIndex += 1) {
      const group = userEditorGroups()[groupIndex];
      if (!group) continue;
      const desired = workset.tabs
        .filter((tab) => tab.groupIndex === groupIndex)
        .sort((left, right) => left.tabIndex - right.tabIndex)
        .map((tab) => restoredById.get(tab.id))
        .filter((tab): tab is vscode.Tab => tab !== undefined);
      await this.syncVsCodeGroupTabOrder(group, desired);
    }
  }

  private applyRestoredPresentationState(workset: StoredWorksetV1, restoredById: ReadonlyMap<string, vscode.Tab>): void {
    this.groupMode = workset.groupMode;
    this.sortMode = workset.sortMode;
    this.manualGroups.splice(0, this.manualGroups.length, ...workset.manualGroups.map((group) => ({ ...group })));
    this.manualGroupByIdentity.clear();
    for (const stored of workset.tabs) {
      const tab = restoredById.get(stored.id);
      if (tab && stored.manualGroupId && this.manualGroups.some((group) => group.id === stored.manualGroupId)) {
        this.manualGroupByIdentity.set(identityKey(targetIdentity(tab)), stored.manualGroupId);
      }
    }
    this.displayOrderByGroup.clear();
    for (const [groupId, entryIds] of workset.manualOrderByGroup) {
      this.displayOrderByGroup.set(groupId, entryIds.flatMap((id) => {
        const tab = restoredById.get(id);
        return tab ? [identityKey(targetIdentity(tab))] : [];
      }));
    }
    this.pinnedGroupIds.clear();
    for (const id of workset.pinnedGroupIds) this.pinnedGroupIds.add(id);
    this.collapsedGroupKeys.clear();
    for (const key of workset.collapsedGroupKeys) this.collapsedGroupKeys.add(key);
  }

  private async closeExtraWorksetGroups(targetGroupCount: number): Promise<WorksetRestoreFailure[]> {
    const failures: WorksetRestoreFailure[] = [];
    const groups = userEditorGroups();
    for (let index = groups.length - 1; index >= targetGroupCount; index -= 1) {
      const group = groups[index];
      if (group.tabs.length === 0) {
        await vscode.window.tabGroups.close(group, true);
      } else {
        failures.push({
          category: 'openFailed',
          label: format(this.localeStrings.editorGroup, index + 1),
          detail: format(this.localeStrings.worksetProtectedGroupRetained, group.tabs.length),
        });
      }
    }
    return failures;
  }

  private async showWorksetRestoreReport(
    workset: StoredWorksetV1,
    restoredCount: number,
    failures: readonly WorksetRestoreFailure[],
  ): Promise<void> {
    if (failures.length === 0) {
      void vscode.window.showInformationMessage(format(this.localeStrings.worksetLoaded, workset.name, restoredCount));
      return;
    }
    const grouped = new Map<WorksetRestoreFailureCategory, WorksetRestoreFailure[]>();
    for (const failure of failures) grouped.set(failure.category, [...(grouped.get(failure.category) ?? []), failure]);
    const detail: string[] = [format(this.localeStrings.worksetRestoreSummary, restoredCount, failures.length)];
    for (const category of ['notFound', 'moved', 'deleted', 'permission', 'unsupported', 'openFailed'] as const) {
      const categoryFailures = grouped.get(category);
      if (!categoryFailures?.length) continue;
      detail.push('', this.worksetFailureCategoryLabel(category));
      detail.push(...categoryFailures.map((failure) => `• ${failure.label} — ${failure.detail}`));
    }
    logWarn('工作集恢复存在未恢复项目', { workset: workset.name, restoredCount, failures });
    const action = await vscode.window.showWarningMessage(
      format(this.localeStrings.worksetRestoreReportTitle, workset.name),
      { modal: true, detail: detail.join('\n') },
      this.localeStrings.showReport,
    );
    if (action === this.localeStrings.showReport) showLogs();
  }

  private worksetFailureCategoryLabel(category: WorksetRestoreFailureCategory): string {
    if (category === 'notFound') return this.localeStrings.worksetFailureNotFound;
    if (category === 'moved') return this.localeStrings.worksetFailureMoved;
    if (category === 'deleted') return this.localeStrings.worksetFailureDeleted;
    if (category === 'permission') return this.localeStrings.worksetFailurePermission;
    if (category === 'unsupported') return this.localeStrings.worksetFailureUnsupported;
    return this.localeStrings.worksetFailureOpen;
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
      this.displayOrderByGroup.delete(displayOrderKey('manual', groupId));
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

  private clearClosedTabState(identity: TabTargetIdentity): boolean {
    const key = identityKey(identity);
    const removedGroup = this.manualGroupByIdentity.delete(key);
    const removedOrder = this.removeDisplayOrderKey(key);
    return removedGroup || removedOrder;
  }

  private removeDisplayOrderKey(key: string): boolean {
    let changed = false;
    for (const [groupId, order] of this.displayOrderByGroup) {
      if (!order.includes(key)) continue;
      this.displayOrderByGroup.set(groupId, order.filter((candidate) => candidate !== key));
      changed = true;
    }
    return changed;
  }

  private removeManualDisplayOrderKey(key: string): boolean {
    let changed = false;
    const manualOrderKeys = new Set([
      displayOrderKey('manual', '__ungrouped'),
      ...this.manualGroups.map((group) => displayOrderKey('manual', group.id)),
    ]);
    for (const [groupId, order] of this.displayOrderByGroup) {
      if (!manualOrderKeys.has(groupId) || !order.includes(key)) continue;
      this.displayOrderByGroup.set(groupId, order.filter((candidate) => candidate !== key));
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
      const manualOrderKeys = new Set([
        displayOrderKey('manual', '__ungrouped'),
        ...this.manualGroups.map((group) => displayOrderKey('manual', group.id)),
      ]);
      for (const [storedGroupId, order] of this.displayOrderByGroup) {
        if (!manualOrderKeys.has(storedGroupId)) continue;
        this.displayOrderByGroup.set(storedGroupId, order.filter((key) => !movedKeySet.has(key)));
      }
      for (const tab of tabsToMove) {
        this.setManualGroup(targetIdentity(tab), groupId);
      }
      if (this.sortMode === 'none') {
        const destinationTabs = this.currentSnapshot.displayGroups
          .find((group) => group.id === destinationGroupId)?.tabs
          .map((tab) => identityKey(tab.target.identity)) ?? [];
        this.displayOrderByGroup.set(displayOrderKey('manual', destinationGroupId), moveItemsBefore(destinationTabs, movedKeys, beforeKey));
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

  private async reorderAutomaticGroupTabs(
    targets: readonly TabTarget[],
    groupId: string | undefined,
    beforeTarget: TabTarget | undefined,
  ): Promise<void> {
    if (targets.length === 0 || !groupId || this.sortMode !== 'none') return;
    const group = this.currentSnapshot.displayGroups.find((candidate) => (
      candidate.id === groupId && candidate.mode === this.groupMode
    ));
    if (!group) {
      logWarn('自动分组内排序失败：目标垂直分组不存在', { groupMode: this.groupMode, groupId, count: targets.length });
      return;
    }

    const movedTabs = targets
      .map((target) => resolveDisplayedTab(this.currentSnapshot, target))
      .filter((tab): tab is VerticalTabItem => tab !== undefined);
    if (movedTabs.length !== targets.length || movedTabs.some((tab) => !group.tabs.includes(tab))) {
      if (this.groupMode === 'fileType') {
        void vscode.window.showInformationMessage(this.localeStrings.cannotMoveBetweenFileTypeGroups);
      }
      logWarn('自动分组内排序失败：标签不属于目标垂直分组', { groupMode: this.groupMode, groupId, count: targets.length });
      return;
    }

    const beforeTab = beforeTarget ? resolveDisplayedTab(this.currentSnapshot, beforeTarget) : undefined;
    const desiredTabs = moveItemsBefore(group.tabs, movedTabs, beforeTab);
    this.setDisplayGroupOrder(group.id, desiredTabs);
    await this.persistManualState();
    logInfo('按垂直显示顺序完成自动分组内排序', { groupMode: this.groupMode, groupId, count: movedTabs.length });
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
      await this.reorderAutomaticGroupTabs(targets, destinationGroup.id, beforeTarget);
      return;
    }

    const destinationDirectory = this.parentDirectoryUri(destinationGroup, targets[0]);
    if (!destinationDirectory) {
      logWarn('父目录分组移动失败：无法解析目标目录', { destinationGroupId, count: targets.length });
      return;
    }

    const movedIdentityKeys: string[] = [];
    const movedSourceKeys = new Set<string>();
    for (const target of targets) {
      const sourceGroup = this.findDisplayGroupForTarget(target);
      if (sourceGroup?.id === destinationGroup.id) continue;
      const movedIdentity = await this.moveFileToDirectory(target, destinationDirectory, destinationGroup.id);
      if (movedIdentity) {
        movedSourceKeys.add(identityKey(target.identity));
        movedIdentityKeys.push(identityKey(movedIdentity));
      }
    }

    if (movedIdentityKeys.length > 0) {
      for (const key of movedSourceKeys) this.removeDisplayOrderKey(key);
      const destinationKeys = destinationGroup.tabs
        .map((tab) => identityKey(tab.target.identity))
        .filter((key) => !movedSourceKeys.has(key));
      const beforeKey = beforeTarget ? identityKey(beforeTarget.identity) : undefined;
      this.displayOrderByGroup.set(
        displayOrderKey('parentDir', destinationGroup.id),
        moveItemsBefore(destinationKeys, movedIdentityKeys, beforeKey),
      );
      await this.persistManualState();
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

  private async moveFileToDirectory(
    target: TabTarget,
    destinationDirectory: vscode.Uri,
    destinationGroupId: string,
  ): Promise<TabTargetIdentity | undefined> {
    const tab = this.resolveTab(target);
    const sourceUri = tab ? inputUri(tab.input) : undefined;
    const sourceTabs = sourceUri ? findTabsByResourceUri(sourceUri) : [];
    if (!tab || !sourceUri || sourceUri.scheme === 'untitled' || sourceTabs.some((candidate) => candidate.isDirty)) {
      logWarn('父目录分组移动失败：仅支持已保存且未修改的文件标签', { target, source: tab ? describeTab(tab) : undefined, destinationGroupId });
      return undefined;
    }
    const destinationUri = vscode.Uri.joinPath(destinationDirectory, path.posix.basename(sourceUri.path));
    if (sourceUri.toString() === destinationUri.toString()) return undefined;
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
          return undefined;
        }
        if (destinationTabs.length > 0) {
          const closed = await vscode.window.tabGroups.close(destinationTabs, true);
          if (!closed || findTabsByResourceUri(destinationUri).length > 0) {
            logWarn('覆盖同名文件已取消：目标标签未能全部关闭', { destination: destinationUri.toString(), destinationGroupId });
            return undefined;
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
      const movedTab = findTabsByResourceUri(destinationUri).find((candidate) => candidate.group.viewColumn === replacementViewColumn)
        ?? findTabsByResourceUri(destinationUri)[0];
      return movedTab ? targetIdentity(movedTab) : undefined;
    } catch (error) {
      logWarn('父目录分组移动文件失败', { source: sourceUri.toString(), destination: destinationUri.toString(), destinationGroupId, error });
      return undefined;
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
    this.displayOrderByGroup.set(displayOrderKey('manual', id), [targetKey, sourceKey]);
    await this.persistManualState();
    logInfo('通过拖拽创建手动分组', { id, name, source: source.label, target: target.label });
  }

  private insertManualOrder(groupId: string, key: string, beforeKey: string | undefined): void {
    const storageKey = displayOrderKey('manual', groupId);
    const current = (this.displayOrderByGroup.get(storageKey) ?? []).filter((candidate) => candidate !== key);
    const beforeIndex = beforeKey ? current.indexOf(beforeKey) : -1;
    if (beforeIndex >= 0) current.splice(beforeIndex, 0, key);
    else current.push(key);
    this.displayOrderByGroup.set(storageKey, current);
  }

  private setDisplayGroupOrder(
    groupId: string,
    tabs: readonly VerticalTabItem[],
  ): void {
    this.displayOrderByGroup.set(
      displayOrderKey(this.groupMode, groupId),
      tabs.map((tab) => identityKey(tab.target.identity)),
    );
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
    if (this.sortMode === 'mru') {
      // MRU is a live presentation order. Physically moving native tabs would
      // activate them during the move and corrupt the usage history itself.
      logDebug('最近使用排序不回写 VS Code 原生标签顺序');
      return;
    }
    const activeIdentity = this.currentSnapshot.tabs.find((tab) => tab.isActive)?.target.identity ?? activeUserTabIdentity();
    const snapshot = await this.createSnapshot();
    this.suppressMruTracking = true;
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
      try {
        await this.restoreActiveTabAfterOrderSync(activeIdentity);
      } finally {
        this.suppressMruTracking = false;
      }
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
      this.context.workspaceState.update(DISPLAY_ORDER_BY_GROUP_STORAGE_KEY, Array.from(this.displayOrderByGroup.entries())),
    ]);
  }

  private async persistGroupMode(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(GROUP_MODE_STORAGE_KEY, this.groupMode);
  }

  private async persistSortMode(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(SORT_MODE_STORAGE_KEY, this.sortMode);
  }

  private async persistSearchVisible(): Promise<void> {
    if (!shouldRememberState()) return;
    await this.context.workspaceState.update(SEARCH_VISIBLE_STORAGE_KEY, this.searchVisible);
  }

  private async persistSearchGroups(): Promise<void> {
    if (!shouldRememberState()) return;
    await this.context.workspaceState.update(SEARCH_GROUPS_STORAGE_KEY, this.searchGroups);
  }

  private async persistToolbarControlsVisible(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(TOOLBAR_CONTROLS_VISIBLE_STORAGE_KEY, this.toolbarControlsVisible);
  }

  private async persistPinnedGroups(): Promise<void> {
    if (shouldRememberState()) await this.context.workspaceState.update(PINNED_GROUP_IDS_STORAGE_KEY, Array.from(this.pinnedGroupIds));
  }

  private async persistCollapsedGroups(): Promise<void> {
    if (shouldRememberState()) {
      await this.context.workspaceState.update(COLLAPSED_GROUP_KEYS_STORAGE_KEY, Array.from(this.collapsedGroupKeys));
    }
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

  private async navigateOnRelease(direction: TabCommandDirection, scope: 'group' | 'all'): Promise<void> {
    await this.ensureShortcutNavigationSnapshot();
    if (this.disposed) return;

    const existing = this.shortcutReleaseNavigation;
    const origin = existing?.origin ?? this.commandAnchorTarget();
    const anchor = existing?.target ?? origin;
    const target = adjacentDisplayedTabTarget(this.currentSnapshot, anchor, direction, scope);
    if (!origin || !target) {
      logDebug('精准快捷键导航无需处理：没有可激活标签', { direction, scope });
      return;
    }

    if (existing) {
      clearTimeout(existing.timeout);
    }
    const id = existing?.id ?? this.nextShortcutReleaseSessionId();
    const timeout = setTimeout(() => {
      void this.cancelShortcutReleaseNavigation('safetyTimeout', true)
        .catch((error) => logError('精准快捷键导航安全超时取消失败', error));
    }, SHORTCUT_RELEASE_SAFETY_TIMEOUT_MS);
    this.shortcutReleaseNavigation = {
      id,
      origin,
      restore: existing?.restore ?? captureActiveUserTabRestore(),
      target,
      timeout,
    };

    this.postMessage({ type: 'previewTabNavigation', target });
    this.postMessage({ type: 'armShortcutReleaseCapture', sessionId: id, primaryKey: 'Tab' });
    this.panel.reveal(this.panel.viewColumn, false);
    this.scheduleMinimizedWidthCorrection('shortcutReleaseNavigation');
    logDebug('更新完全释放后提交的快捷键标签导航候选', {
      direction,
      scope,
      sessionId: id,
      target,
      displayGroupId: this.findDisplayGroupForTarget(target)?.id,
    });
  }

  private async ensureShortcutNavigationSnapshot(): Promise<void> {
    if (this.currentSnapshot.revision > 0 && this.appliedSnapshotGeneration === this.snapshotGeneration) {
      return;
    }
    if (this.shortcutNavigationPreparation) {
      await this.shortcutNavigationPreparation;
      return;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    const preparation = this.refresh({ reason: 'shortcutNavigationPrepare', ensureEmptyLayout: false });
    this.shortcutNavigationPreparation = preparation;
    try {
      await preparation;
    } finally {
      if (this.shortcutNavigationPreparation === preparation) {
        this.shortcutNavigationPreparation = undefined;
      }
    }
  }

  private async commitShortcutNavigation(target: TabTarget): Promise<boolean> {
    if (this.disposed) return false;

    this.shortcutNavigationActivationDepth += 1;
    const previousSuppression = this.suppressScheduledRefresh;
    this.suppressScheduledRefresh = true;
    try {
      let tab = this.resolveTab(target);
      if (!tab) {
        logDebug('快捷键导航候选已过期，刷新快照后重试', { target });
        await this.refresh({ reason: 'shortcutNavigationRetry', ensureEmptyLayout: false });
        tab = this.resolveTab(target);
      }
      if (!tab) {
        logWarn('快捷键标签导航失败：最终候选已失效', { target });
        return false;
      }

      logDebug('提交快捷键标签导航最终候选', {
        label: tab.label,
        inputKind: inputKind(tab.input),
        target,
      });
      await this.activateTab(tab);
      await this.refresh({ reason: 'navigate' });
      return true;
    } finally {
      this.suppressScheduledRefresh = previousSuppression;
      this.shortcutNavigationActivationDepth -= 1;
    }
  }

  private nextShortcutReleaseSessionId(): string {
    this.shortcutReleaseSequence = (this.shortcutReleaseSequence % Number.MAX_SAFE_INTEGER) + 1;
    return `shortcut-release-${this.shortcutReleaseSequence}`;
  }

  private async completeShortcutReleaseNavigation(sessionId: string): Promise<void> {
    const session = this.clearShortcutReleaseNavigation('complete', sessionId, false);
    if (!session) {
      logDebug('忽略过期的精准快捷键导航完成消息', { sessionId });
      return;
    }

    logDebug('组合键已完全释放，提交最终标签候选', { sessionId, target: session.target });
    const committed = await this.commitShortcutNavigation(session.target);
    if (!committed) {
      await this.restoreShortcutReleaseOrigin(session);
    }
  }

  private async cancelShortcutReleaseNavigation(
    reason: string,
    restoreOrigin: boolean,
    restoreDelayMs = 0,
    sessionId?: string,
  ): Promise<void> {
    const session = this.clearShortcutReleaseNavigation(reason, sessionId);
    if (!session || !restoreOrigin) return;
    if (restoreDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, restoreDelayMs));
    }
    await this.restoreShortcutReleaseOrigin(session);
  }

  private clearShortcutReleaseNavigation(
    reason: string,
    sessionId?: string,
    notifyWebview = true,
  ): ShortcutReleaseNavigationSession | undefined {
    const session = this.shortcutReleaseNavigation;
    if (!session || (sessionId !== undefined && session.id !== sessionId)) return undefined;

    clearTimeout(session.timeout);
    this.shortcutReleaseNavigation = undefined;
    if (notifyWebview) {
      this.postMessage({ type: 'cancelShortcutReleaseCapture', sessionId: session.id });
    }
    this.postMessage({ type: 'clearTabNavigationPreview' });
    logDebug('取消或结束精准快捷键标签导航', { reason, sessionId: session.id, target: session.target });
    return session;
  }

  private async restoreShortcutReleaseOrigin(session: ShortcutReleaseNavigationSession): Promise<void> {
    if (this.disposed || this.shortcutReleaseNavigation || !session.restore || !this.isOwnGroupActive()) return;

    this.shortcutNavigationActivationDepth += 1;
    const previousMruSuppression = this.suppressMruTracking;
    this.suppressMruTracking = true;
    try {
      await this.restoreActiveUserTab(session.restore);
      await this.refresh({ reason: 'shortcutReleaseCancelRestore', ensureEmptyLayout: false });
      logDebug('精准快捷键导航取消后恢复原活动标签', { sessionId: session.id, origin: session.origin });
    } finally {
      this.suppressMruTracking = previousMruSuppression;
      this.shortcutNavigationActivationDepth -= 1;
    }
  }

  private isOwnGroupActive(): boolean {
    return vscode.window.tabGroups.all[this.findOwnGroupIndex()]?.isActive === true;
  }

  private async moveByCommand(direction: TabCommandDirection, scope: 'tab' | 'group'): Promise<void> {
    await this.refresh({ reason: 'operation' });
    const anchorTarget = this.commandAnchorTarget();
    const anchor = anchorTarget ? this.resolveTab(anchorTarget) : undefined;
    if (!anchorTarget || !anchor || isVerticalTabsPanel(anchor)) {
      logDebug('标签移动命令无需处理：没有活动用户标签', { direction, scope });
      return;
    }

    if (scope === 'tab') {
      if (this.sortMode !== 'none') {
        void vscode.window.showInformationMessage(this.localeStrings.moveRequiresManualSort);
        logDebug('自动排序下拒绝组内标签移动命令', { direction, groupMode: this.groupMode, sortMode: this.sortMode });
        return;
      }

      const plan = planDisplayedTabMove(this.currentSnapshot, anchorTarget, this.commandSelectedTargets, direction);
      if (!plan?.changed) {
        logDebug('垂直组内标签移动命令已位于边界', { direction, count: plan?.movedTabs.length ?? 0 });
        return;
      }

      if (this.groupMode === 'vscode') {
        const sourceGroup = anchor.group;
        const desiredOrder = plan.desiredTabs
          .map((tab) => this.resolveTab(tab.target))
          .filter((tab): tab is vscode.Tab => tab !== undefined && tab.group === sourceGroup);
        if (desiredOrder.length !== plan.desiredTabs.length) {
          logWarn('跟随 VS Code 模式组内移动失败：垂直顺序目标已失效', { direction, expected: plan.desiredTabs.length, resolved: desiredOrder.length });
          return;
        }
        try {
          await this.syncVsCodeGroupTabOrder(sourceGroup, desiredOrder);
        } finally {
          await this.restoreCommandAnchor(anchor);
        }
      } else {
        this.setDisplayGroupOrder(plan.group.id, plan.desiredTabs);
        await this.persistManualState();
      }

      await this.refresh({ reason: 'operation' });
      logInfo('按垂直显示顺序完成组内标签移动命令', {
        direction,
        count: plan.movedTabs.length,
        groupMode: this.groupMode,
        displayGroupId: plan.group.id,
      });
      return;
    }

    const destination = adjacentDisplayedGroup(this.currentSnapshot, anchorTarget, direction);
    const selectedTabs = selectedDisplayedTabsInAnchorGroup(
      this.currentSnapshot,
      anchorTarget,
      this.commandSelectedTargets,
    );
    if (!destination || selectedTabs.length === 0) {
      logDebug('跨垂直组标签移动命令已位于边界或没有有效标签', {
        direction,
        count: selectedTabs.length,
        displayGroupCount: this.currentSnapshot.displayGroups.length,
      });
      return;
    }

    const targets = selectedTabs.map((tab) => tab.target);
    if (this.groupMode === 'fileType') {
      void vscode.window.showInformationMessage(this.localeStrings.cannotMoveBetweenFileTypeGroups);
      logDebug('文件类型分组拒绝跨组移动命令', { direction, count: targets.length, destinationGroupId: destination.id });
      return;
    }
    if (this.groupMode === 'parentDir') {
      await this.moveParentDirectoryTabs(targets, destination.id, undefined);
    } else if (this.groupMode === 'manual') {
      await this.moveTabs(targets, destination.id === '__ungrouped' ? undefined : destination.id, undefined);
    } else {
      await this.moveTabs(targets, destination.id, undefined);
    }

    await this.refresh({ reason: 'operation' });
    logInfo('按垂直显示顺序完成跨组标签移动命令', {
      direction,
      count: targets.length,
      groupMode: this.groupMode,
      destinationGroupId: destination.id,
    });
  }

  private commandAnchorTarget(): TabTarget | undefined {
    const activeGroup = userEditorGroups().find((group) => group.isActive);
    if (activeGroup?.activeTab && !isVerticalTabsPanel(activeGroup.activeTab)) {
      return this.currentSnapshot.tabs.find((tab) => (
        tab.target.groupIndex === vscode.window.tabGroups.all.indexOf(activeGroup)
        && sameIdentity(tab.target.identity, targetIdentity(activeGroup.activeTab!))
      ))?.target;
    }

    const selectedTabs = this.commandSelectedTargets
      .map((target) => resolveDisplayedTab(this.currentSnapshot, target))
      .filter((tab): tab is NonNullable<typeof tab> => tab !== undefined);
    const snapshotAnchor = this.currentSnapshot.tabs.find((tab) => tab.isFocused)
      ?? this.currentSnapshot.tabs.find((tab) => tab.isActive && this.commandSelectedTargets.some((target) => (
        target.groupIndex === tab.target.groupIndex && sameIdentity(target.identity, tab.target.identity)
      )));
    return selectedTabs.find((tab) => {
      const live = this.resolveTab(tab.target);
      return live?.group.activeTab === live;
    })?.target
      ?? selectedTabs[0]?.target
      ?? snapshotAnchor?.target;
  }

  private async restoreCommandAnchor(anchor: vscode.Tab): Promise<void> {
    if (findTabPosition(anchor) && isActivatableTabForCommands(anchor)) {
      await this.activateTab(anchor, 'restore-active-after-command-move');
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
      if (!this.suppressMruTracking) {
        this.mruTracker.recordSuccessfulActivation(tab);
        if (this.sortMode === 'mru') this.scheduleRefresh();
      }
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${this.panel.webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">${styleContent}</style>
  <title>${TITLE}</title>
</head>
<body>
  <main class="vertical-tabs" data-toolbar-position="${this.toolbarPosition}" aria-live="polite">
    <header class="toolbar">
      <div class="toolbar-actions">
        <button id="toggle-search" class="toolbar-icon" type="button" title="" aria-label=""><span class="codicon codicon-search" aria-hidden="true"></span></button>
        <button id="worksets" class="toolbar-icon" type="button" title="${i18n.worksets}" aria-label="${i18n.worksets}"><span class="codicon codicon-archive" aria-hidden="true"></span></button>
        <button id="toggle-toolbar-controls" class="toolbar-icon" type="button" title="" aria-label=""><span class="codicon codicon-settings-gear" aria-hidden="true"></span></button>
        <button id="expand-all" class="toolbar-icon" type="button" title="" aria-label=""><span class="codicon codicon-expand-all" aria-hidden="true"></span></button>
        <button id="collapse-all" class="toolbar-icon" type="button" title="" aria-label=""><span class="codicon codicon-collapse-all" aria-hidden="true"></span></button>
      </div>
      <div id="toolbar-controls" class="toolbar-selects">
        <label class="toolbar-field" for="group-mode"><span>${i18n.groupModeLabel}</span><select id="group-mode"><option value="vscode">${i18n.groupModeVscode}</option><option value="manual">${i18n.groupModeManual}</option><option value="parentDir">${i18n.groupModeParentDir}</option><option value="fileType">${i18n.groupModeFileType}</option></select></label>
        <label class="toolbar-field" for="sort-mode"><span>${i18n.sortModeLabel}</span><select id="sort-mode"><option value="none">${i18n.sortModeNone}</option><option value="mru">${i18n.sortModeMru}</option><option value="modifiedAsc">${i18n.sortModeModifiedAsc}</option><option value="modifiedDesc">${i18n.sortModeModifiedDesc}</option><option value="nameAsc">${i18n.sortModeNameAsc}</option><option value="nameDesc">${i18n.sortModeNameDesc}</option></select></label>
      </div>
      <div id="search-container" class="search-container">
        <div class="search-input-row">
          <input id="search-input" class="search-input" type="text" placeholder="${i18n.searchPlaceholder}" aria-describedby="search-result-count search-error" />
          <div class="search-mode-actions">
            <button id="regex-search-toggle" class="search-mode-toggle" type="button" title="${i18n.regexSearch}" aria-label="${i18n.regexSearch}" aria-pressed="false">.*</button>
            <button id="search-group-toggle" class="search-mode-toggle" type="button" title="${i18n.searchGroup}" aria-label="${i18n.searchGroup}" aria-pressed="false"><span class="codicon codicon-group-by-ref-type" aria-hidden="true"></span></button>
            <button id="search-workspace-relative-path-toggle" class="search-mode-toggle" type="button" title="${i18n.searchWorkspaceRelativePaths}" aria-label="${i18n.searchWorkspaceRelativePaths}" aria-pressed="false"><span class="codicon codicon-root-folder" aria-hidden="true"></span></button>
          </div>
        </div>
        <div class="search-feedback">
          <span id="search-result-count" class="search-result-count" role="status" hidden></span>
          <span id="search-error" class="search-error" role="alert" hidden></span>
        </div>
      </div>
    </header>
    <p id="description"></p>
    <section id="groups" role="tree" tabindex="0" aria-label="打开的编辑器标签"></section>
  </main>
  <script nonce="${nonce}">var __i18n = ${JSON.stringify(i18n)};</script>
  <script nonce="${nonce}">${scriptContent}</script>
</body>
</html>`;
  }

  private readWebviewStyle(): string {
    const stylePath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vertical-tabs.css').fsPath;
    try {
      const source = fs.readFileSync(stylePath, 'utf8');
      const codiconStylePath = vscode.Uri.joinPath(this.context.extensionUri, 'out', 'codicon.css').fsPath;
      const codiconFontUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'codicon.ttf')).toString();
      const codiconSource = fs.readFileSync(codiconStylePath, 'utf8')
        .replace(/url\((["']?)\.\/codicon\.ttf[^)]*\)/, `url($1${codiconFontUri}$1)`);
      const combined = [codiconSource, source].join('\n').replace(/<\/style/gi, '<\\/style');
      logDebug('已内联读取 Webview 样式与 Codicon 字体', { stylePath, codiconStylePath, bytes: combined.length });
      return combined;
    } catch (error) {
      logError('读取 Webview 样式失败，将使用最小降级样式', { stylePath, error });
      return [
        ':root { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }',
        'html, body { height: 100%; }',
        'body { margin: 0; overflow: hidden; }',
        '.vertical-tabs { box-sizing: border-box; display: flex; flex-direction: column; height: 100vh; min-width: 180px; overflow: hidden; padding: 6px; }',
        '.vertical-tabs[data-toolbar-position="bottom"] .toolbar { flex-direction: column-reverse; order: 2; }',
        '#groups { flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-width: none; }',
        '#groups::-webkit-scrollbar { display: none; }',
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
      const userGroupSide = this.railPosition === 'left' ? 'right' : 'left';
      logInfo('检测到垂直标签栏没有可显示标签，准备恢复对侧编辑器区域', {
        ratio,
        railPosition: this.railPosition,
        userGroupSide,
        reusableViewColumn,
      });
      this.arrangingRail = true;
      try {
        const currentReusable = reusableViewColumn ?? findReusableEmptyUserGroupColumn(this.findOwnGroupIndex());
        if (currentReusable === undefined) {
          const ownGroup = vscode.window.tabGroups.all[this.findOwnGroupIndex()];
          if (ownGroup) {
            this.panel.reveal(ownGroup.viewColumn, false);
            await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
          }
          await vscode.commands.executeCommand(
            this.railPosition === 'left'
              ? 'workbench.action.newGroupRight'
              : 'workbench.action.newGroupLeft',
          );
        } else {
          await focusEditorGroup(currentReusable);
        }
        await openWelcomeEditor();
        await closeExtraEmptyUserGroups(this.findOwnGroupIndex());
        await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
        const moveResult = await this.moveOwnGroupToPosition(this.railPosition);
        if (!moveResult.success) {
          logWarn('恢复空垂直标签栏时无法将专用组放回配置边缘', {
            railPosition: this.railPosition,
            tabGroups: describeTabGroups(),
          });
          return false;
        }
        if (!await applyRailRatio(ratio, this.railPosition)) {
          logWarn('恢复空垂直标签栏宽度失败');
          return false;
        }
        if (!await this.focusAndLockOwnGroup()) {
          return false;
        }
        logInfo('已恢复空垂直标签栏的对侧编辑器区域和宽度', {
          ratio,
          railPosition: this.railPosition,
          userGroupSide,
        });
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
      logDebug('已在用户编辑器区域打开 VS Code 欢迎页', { command });
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

function disposeAll(disposables: readonly vscode.Disposable[]): void {
  for (const disposable of disposables) disposable.dispose();
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

function userEditorGroups(): vscode.TabGroup[] {
  return vscode.window.tabGroups.all.filter((group) => !group.tabs.some((tab) => isVerticalTabsPanel(tab)));
}

function captureActiveUserTabRestore(): ActiveUserTabRestore | undefined {
  const allGroups = vscode.window.tabGroups.all;
  const activeGroup = allGroups.find((group) => group.isActive);
  const activeTab = activeGroup?.activeTab;
  if (!activeGroup || !activeTab || isVerticalTabsPanel(activeTab)) {
    return undefined;
  }

  const userGroups = allGroups.filter((group) => !group.tabs.some((tab) => isVerticalTabsPanel(tab)));
  const userGroupIndex = userGroups.indexOf(activeGroup);
  if (userGroupIndex < 0) {
    return undefined;
  }
  return {
    identity: targetIdentity(activeTab),
    userGroupIndex,
    tabIndex: activeGroup.tabs.indexOf(activeTab),
    ...(activeTab.input instanceof vscode.TabInputText
      && vscode.window.activeTextEditor?.document.uri.toString() === activeTab.input.uri.toString()
      ? { selection: vscode.window.activeTextEditor.selection }
      : {}),
  };
}

function findUserTabForRestore(restore: ActiveUserTabRestore): vscode.Tab | undefined {
  const userGroups = vscode.window.tabGroups.all.filter(
    (group) => !group.tabs.some((tab) => isVerticalTabsPanel(tab)),
  );
  const preferredGroup = userGroups[restore.userGroupIndex];
  const indexedTab = preferredGroup?.tabs[restore.tabIndex];
  if (indexedTab && sameIdentity(targetIdentity(indexedTab), restore.identity)) {
    return indexedTab;
  }
  const groupMatch = preferredGroup?.tabs.find(
    (tab) => sameIdentity(targetIdentity(tab), restore.identity),
  );
  if (groupMatch) {
    return groupMatch;
  }

  const matches = userGroups.flatMap((group) => group.tabs).filter(
    (tab) => sameIdentity(targetIdentity(tab), restore.identity),
  );
  return matches.length === 1 ? matches[0] : undefined;
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

function isGroupAtRailPosition(
  group: vscode.TabGroup | undefined,
  position: RailPosition,
): boolean {
  if (!group) {
    return false;
  }
  const columns = vscode.window.tabGroups.all.map((candidate) => candidate.viewColumn);
  if (columns.length === 0) {
    return false;
  }
  const edgeColumn = position === 'left' ? Math.min(...columns) : Math.max(...columns);
  return group.viewColumn === edgeColumn;
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

async function waitForEditorLayoutLeafCount(expectedLeaves: number): Promise<boolean> {
  for (let attempt = 0; attempt < GROUP_PUBLISH_WAIT_ATTEMPTS; attempt += 1) {
    const layout = await getEditorLayout();
    if (layout && countLayoutLeaves(layout) === expectedLeaves) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
  }
  logWarn('等待编辑器组关闭后的布局发布超时', { expectedLeaves });
  return false;
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

async function prepareRailGroup(
  context: vscode.ExtensionContext,
  position: RailPosition,
): Promise<PreparedRailGroup | undefined> {
  const savedRatio = shouldRememberState() ? context.globalState.get<number>(WIDTH_RATIO_STORAGE_KEY) : undefined;
  const configuredRatio = readConfiguredRailRatio();
  const ratio = getConfiguredRailRatio(context);
  const previousLayout = await getEditorLayout();
  const creationLayoutPreparation = previousLayout
    ? await prepareNarrowEdgeEditorGroupBeforeRailCreation(previousLayout, position)
    : undefined;
  const creationLayout = creationLayoutPreparation?.layout ?? previousLayout;
  const createCommand = position === 'left'
    ? 'workbench.action.newGroupLeft'
    : 'workbench.action.newGroupRight';
  const activeViewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
  const anchorViewColumn = creationLayout
    ? selectWidestEditorGroupViewColumn(
      creationLayout,
      vscode.window.tabGroups.all.map((group) => group.viewColumn),
      activeViewColumn,
    )
    : activeViewColumn;
  try {
    if (anchorViewColumn !== undefined && anchorViewColumn !== activeViewColumn) {
      await focusEditorGroup(anchorViewColumn);
    }
    await vscode.commands.executeCommand(createCommand);
    const moveResult = await moveActiveEmptyGroupToRailEdge(position);
    const viewColumn = moveResult.viewColumn;
    const expectedGroupCount = previousLayout ? countLayoutLeaves(previousLayout) + 1 : undefined;
    const edgeGroup = vscode.window.tabGroups.all.find((group) => group.viewColumn === viewColumn);
    const canApplyBeforePanel = previousLayout !== undefined
      && moveResult.success
      && vscode.window.tabGroups.all.length === expectedGroupCount
      && edgeGroup?.tabs.length === 0;
    const layoutAppliedBeforePanel = canApplyBeforePanel
      ? await applyRailRatio(ratio, position, previousLayout)
      : false;
    logDebug('在创建 Webview 前通过原生命令新建边缘空编辑器分组', {
      position,
      activeViewColumn,
      anchorViewColumn,
      createCommand,
      emptyGroupMoved: moveResult.moved,
      emptyGroupReachedEdge: moveResult.success,
      edgeNudgeApplied: creationLayoutPreparation?.applied ?? false,
      edgeNudgeMode: creationLayoutPreparation?.mode,
      edgeWidthBeforeNudge: creationLayoutPreparation?.previousWidth,
      edgeWidthAfterNudge: creationLayoutPreparation?.preparedWidth,
      viewColumn,
      editorGroups: vscode.window.tabGroups.all.length,
      expectedGroupCount,
      edgeGroupIsEmpty: edgeGroup?.tabs.length === 0,
      layoutAppliedBeforePanel,
      savedRatio,
      configuredRatio,
      ratio,
      previousLayout,
    });
    return { ratio, viewColumn, previousLayout, layoutAppliedBeforePanel };
  } catch (error) {
    if (creationLayoutPreparation?.applied && previousLayout) {
      await applyEditorLayout(previousLayout).catch(() => false);
    }
    logError('创建边缘空编辑器分组失败', {
      position,
      activeViewColumn,
      anchorViewColumn,
      createCommand,
      savedRatio,
      configuredRatio,
      ratio,
      previousLayout,
      error,
    });
    return undefined;
  }
}

interface RailCreationLayoutPreparation {
  readonly layout: EditorLayout;
  readonly applied: boolean;
  readonly mode?: 'pixel' | 'ratio';
  readonly previousWidth?: number;
  readonly preparedWidth?: number;
}

async function prepareNarrowEdgeEditorGroupBeforeRailCreation(
  layout: EditorLayout,
  position: RailPosition,
): Promise<RailCreationLayoutPreparation> {
  const edgeIndex = position === 'left' ? 0 : layout.groups.length - 1;
  const previousWidth = layout.groups[edgeIndex]?.size;
  if (typeof previousWidth !== 'number' || !Number.isFinite(previousWidth)) {
    return { layout, applied: false };
  }

  const totalWidth = getEditorAreaWidth(layout);
  const attempts: ReadonlyArray<{ readonly mode: 'pixel' | 'ratio'; readonly delta: number }> = [
    { mode: 'pixel', delta: 1 },
    { mode: 'ratio', delta: Math.max(2, Math.ceil(totalWidth * 0.001)) },
  ];
  for (const attempt of attempts) {
    const nextLayout = nudgeNarrowEdgeEditorGroupWidth(layout, position, attempt.delta);
    if (!nextLayout) {
      return { layout, applied: false };
    }
    logDebug('创建垂直标签栏前预扩宽边缘窄编辑器组', {
      position,
      mode: attempt.mode,
      delta: attempt.delta,
      previousWidth,
      nextWidth: nextLayout.groups[edgeIndex]?.size,
      previousLayout: layout,
      nextLayout,
    });
    if (!await applyEditorLayout(nextLayout)) {
      continue;
    }
    const verifiedLayout = await waitForNarrowEdgeEditorGroupNudge(position, previousWidth);
    const preparedWidth = verifiedLayout?.groups[edgeIndex]?.size;
    if (verifiedLayout && typeof preparedWidth === 'number' && preparedWidth > previousWidth) {
      logInfo('创建垂直标签栏前已预扩宽边缘窄编辑器组', {
        position,
        mode: attempt.mode,
        previousWidth,
        preparedWidth,
      });
      return {
        layout: verifiedLayout,
        applied: true,
        mode: attempt.mode,
        previousWidth,
        preparedWidth,
      };
    }
    logWarn(
      attempt.mode === 'pixel'
        ? '创建垂直标签栏前的边缘组像素预扩宽未生效，尝试极小比例调整'
        : '创建垂直标签栏前的边缘组极小比例预扩宽未生效',
      {
        position,
        mode: attempt.mode,
        previousWidth,
        requestedWidth: nextLayout.groups[edgeIndex]?.size,
      },
    );
  }

  logWarn('无法在创建垂直标签栏前安全预扩宽边缘窄编辑器组，将继续使用原布局', {
    position,
    previousWidth,
    layout,
  });
  return { layout, applied: false };
}

async function waitForNarrowEdgeEditorGroupNudge(
  position: RailPosition,
  previousWidth: number,
): Promise<EditorLayout | undefined> {
  for (let attempt = 0; attempt < GROUP_PUBLISH_WAIT_ATTEMPTS; attempt += 1) {
    const layout = await getEditorLayout();
    const edgeIndex = layout ? (position === 'left' ? 0 : layout.groups.length - 1) : -1;
    const width = edgeIndex >= 0 ? layout?.groups[edgeIndex]?.size : undefined;
    if (layout && countLayoutLeaves(layout) === vscode.window.tabGroups.all.length
      && typeof width === 'number' && width > previousWidth) {
      return layout;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
  }
  return undefined;
}

async function moveActiveEmptyGroupToRailEdge(
  position: RailPosition,
): Promise<{ readonly viewColumn: vscode.ViewColumn; readonly success: boolean; readonly moved: boolean }> {
  const command = position === 'left'
    ? 'workbench.action.moveActiveEditorGroupLeft'
    : 'workbench.action.moveActiveEditorGroupRight';
  const maxMoves = Math.max(1, vscode.window.tabGroups.all.length);
  let moved = false;

  for (let attempt = 0; attempt <= maxMoves; attempt += 1) {
    const activeGroup = vscode.window.tabGroups.activeTabGroup;
    if (activeGroup.tabs.length !== 0) {
      logWarn('无法在显示前移动新建组：活动组已包含标签', {
        position,
        attempt,
        viewColumn: activeGroup.viewColumn,
        tabGroups: describeTabGroups(),
      });
      return { viewColumn: activeGroup.viewColumn, success: false, moved };
    }
    if (isGroupAtRailPosition(activeGroup, position)) {
      return { viewColumn: activeGroup.viewColumn, success: true, moved };
    }
    if (attempt === maxMoves) {
      break;
    }

    const beforeColumn = activeGroup.viewColumn;
    await vscode.commands.executeCommand(command);
    await new Promise<void>((resolve) => setTimeout(resolve, GROUP_WAIT_INTERVAL_MS));
    const nextGroup = vscode.window.tabGroups.activeTabGroup;
    if (nextGroup.viewColumn === beforeColumn) {
      logWarn('移动新建空编辑器组的命令未改变位置', {
        position,
        command,
        beforeColumn,
        tabGroups: describeTabGroups(),
      });
      return { viewColumn: nextGroup.viewColumn, success: false, moved };
    }
    moved = true;
  }

  const activeGroup = vscode.window.tabGroups.activeTabGroup;
  logWarn('新建空编辑器组在安全次数内未到达配置边缘', {
    position,
    command,
    maxMoves,
    viewColumn: activeGroup.viewColumn,
    tabGroups: describeTabGroups(),
  });
  return { viewColumn: activeGroup.viewColumn, success: false, moved };
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

async function applyRailRatio(
  ratio: number,
  position: RailPosition,
  previousLayout?: EditorLayout,
): Promise<boolean> {
  const layout = await getEditorLayout();
  if (!layout || layout.orientation !== 0 || layout.groups.length < 2) {
    logWarn('无法在当前布局中调整垂直标签栏宽度', { position, layout });
    return false;
  }
  const totalWidth = getEditorAreaWidth(layout);
  const normalizedRatio = clampAutomaticRailRatio(ratio, { source: 'applyRailRatio', position });
  const railWidth = Math.max(SAFE_RAIL_WIDTH, Math.ceil(totalWidth * normalizedRatio));
  if (previousLayout && countLayoutLeaves(layout) === countLayoutLeaves(previousLayout) + 1) {
    const previousTotalWidth = getEditorAreaWidth(previousLayout);
    const preservedRailWidth = Math.max(SAFE_RAIL_WIDTH, Math.ceil(previousTotalWidth * normalizedRatio));
    const preservedLayout = insertRailPreservingEditorWidths(previousLayout, preservedRailWidth, position);
    if (preservedLayout) {
      logDebug('按创建前布局安全分配垂直标签栏宽度', {
        position,
        requestedRatio: ratio,
        normalizedRatio,
        widthContributions: describeRailWidthContributions(previousLayout, preservedLayout, position),
        previousLayout,
        currentLayout: layout,
        nextLayout: preservedLayout,
      });
      return applyEditorLayout(preservedLayout);
    }
    logWarn('创建前编辑器组没有足够安全余量，保留 VS Code 新建分组后的原生布局', {
      position,
      requestedRatio: ratio,
      normalizedRatio,
      minimumRailWidth: SAFE_RAIL_WIDTH,
      minimumEditorWidth: VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
      previousLayout,
      currentLayout: layout,
    });
    return true;
  }
  const existingRailLikeGroup = findExistingRailLikeRootGroup(layout, position);
  logDebug('准备调整垂直标签栏宽度', {
    position,
    requestedRatio: ratio,
    normalizedRatio,
    totalWidth,
    railWidth,
    existingRailLikeGroup,
    layout,
    tabGroups: describeTabGroups(),
  });
  if (existingRailLikeGroup !== undefined) {
    logDebug('跳过调整垂直标签栏宽度：目标边缘已有匹配比例的小宽度编辑器组', {
      position,
      requestedRatio: ratio,
      normalizedRatio,
      existingRailLikeGroup,
      layout,
    });
    return true;
  }
  const nextLayout = setRailRootGroupWidth(layout, railWidth, position);
  if (!nextLayout) {
    logWarn('无法为当前编辑器布局生成垂直标签栏宽度', { position, layout, railWidth });
    return false;
  }
  logDebug('应用垂直标签栏宽度布局', {
    position,
    requestedRatio: ratio,
    normalizedRatio,
    previousLayout: layout,
    nextLayout,
  });
  return applyEditorLayout(nextLayout);
}

function describeRailWidthContributions(
  previousLayout: EditorLayout,
  nextLayout: EditorLayout,
  position: RailPosition,
): readonly (RailWidthContribution & {
  readonly previousWidth: number;
  readonly nextWidth: number;
})[] {
  const nextEditorGroups = position === 'left'
    ? nextLayout.groups.slice(1)
    : nextLayout.groups.slice(0, -1);
  return previousLayout.groups.flatMap((group, index) => {
    const previousWidth = group.size;
    const nextWidth = nextEditorGroups[index]?.size;
    if (
      typeof previousWidth !== 'number'
      || !Number.isFinite(previousWidth)
      || typeof nextWidth !== 'number'
      || !Number.isFinite(nextWidth)
      || nextWidth >= previousWidth
    ) {
      return [];
    }
    return [{
      editorGroupIndex: index,
      previousWidth,
      nextWidth,
      contribution: previousWidth - nextWidth,
    }];
  });
}

function clampAutomaticRailRatio(ratio: number, details: Record<string, unknown>): number {
  const normalized = normalizeRailRatio(ratio);
  const clamped = Math.min(normalized, MAX_AUTO_APPLIED_RAIL_RATIO);
  if (clamped !== normalized) {
    logWarn('自动应用垂直标签栏宽度比例过大，已限制以避免过度压缩用户编辑器组', {
      ...details,
      requestedRatio: ratio,
      normalizedRatio: normalized,
      clampedRatio: clamped,
      maxAutoAppliedRailRatio: MAX_AUTO_APPLIED_RAIL_RATIO,
    });
  }
  return clamped;
}

function findExistingRailLikeRootGroup(
  layout: EditorLayout,
  position: RailPosition,
): { readonly index: number; readonly size: number; readonly ratio: number } | undefined {
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
  const railIndex = getRailRootGroupIndex(layout, position);
  const railGroup = sizedGroups.find((group) => group.index === railIndex);
  if (!railGroup) return undefined;
  const railRatio = railGroup.size / totalWidth;
  // Once the configured edge group is already narrow, preserve the user's
  // native divider width regardless of how many groups share the other side.
  if (railRatio > MAX_EMPTY_RAIL_RESTORE_RATIO) return undefined;
  return { index: railGroup.index, size: railGroup.size, ratio: railRatio };
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

function worksetInputFromTab(tab: vscode.Tab): WorksetTabInput {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return { kind: 'text', uri: input.uri.toString() };
  if (input instanceof vscode.TabInputTextDiff) {
    return { kind: 'diff', originalUri: input.original.toString(), modifiedUri: input.modified.toString() };
  }
  if (input instanceof vscode.TabInputCustom) {
    return { kind: 'custom', uri: input.uri.toString(), viewType: input.viewType };
  }
  if (input instanceof vscode.TabInputNotebook) {
    return { kind: 'notebook', uri: input.uri.toString(), notebookType: input.notebookType };
  }
  if (input instanceof vscode.TabInputNotebookDiff) {
    return {
      kind: 'notebookDiff',
      originalUri: input.original.toString(),
      modifiedUri: input.modified.toString(),
      notebookType: input.notebookType,
    };
  }
  if (input instanceof vscode.TabInputWebview) {
    const builtIn = getActivatableBuiltInWebviewTarget(tab);
    return { kind: 'webview', viewType: input.viewType, label: tab.label, ...(builtIn ? { builtIn } : {}) };
  }
  if (input instanceof vscode.TabInputTerminal) return { kind: 'terminal', label: tab.label };
  return { kind: 'unknown', label: tab.label };
}

function findMatchingTabInGroup(group: vscode.TabGroup, input: WorksetTabInput): vscode.Tab | undefined {
  const key = worksetInputKey(input);
  return group.tabs.find((tab) => !isVerticalTabsPanel(tab) && worksetInputKey(worksetInputFromTab(tab)) === key);
}

function escapeGlobSegment(value: string): string {
  return value.replace(/[\\*?{}[\]]/g, (character) => `[${character}]`);
}

function isPermissionError(error: unknown): boolean {
  return error instanceof vscode.FileSystemError
    ? error.code === 'NoPermissions'
    : error instanceof Error && /permission|access denied|eacces/i.test(error.message);
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof vscode.FileSystemError
    ? error.code === 'FileNotFound'
    : error instanceof Error && /not found|enoent/i.test(error.message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function inputWorkspaceRelativePath(input: vscode.Tab['input']): string | undefined {
  const uri = inputUri(input);
  if (!uri || !vscode.workspace.getWorkspaceFolder(uri)) {
    return undefined;
  }
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

function inputDirectoryName(input: vscode.Tab['input']): string | undefined {
  const uri = inputUri(input);
  if (!uri) {
    return undefined;
  }
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    const directoryPath = path.posix.dirname(relativePath);
    return directoryPath === '.' ? workspaceFolder.name : path.posix.basename(directoryPath);
  }
  const directoryPath = path.posix.dirname(uri.path.replace(/\\/g, '/'));
  const directoryName = path.posix.basename(directoryPath);
  return directoryName && directoryName !== '.' ? directoryName : undefined;
}

function createWebviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(context.extensionUri, 'out'),
      vscode.Uri.joinPath(context.extensionUri, 'media'),
    ],
  };
}

function createWebviewPanelOptions(context: vscode.ExtensionContext): vscode.WebviewPanelOptions & vscode.WebviewOptions {
  return {
    ...createWebviewOptions(context),
    retainContextWhenHidden: true,
  };
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

function readonlyPatternMatch(uri: vscode.Uri): ReadonlyPatternMatch {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) return { included: false, excluded: false };
  const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  const configuration = vscode.workspace.getConfiguration('files', uri);
  return matchReadonlyPatterns(
    relativePath,
    configuration.get<Record<string, unknown>>('readonlyInclude'),
    configuration.get<Record<string, unknown>>('readonlyExclude'),
    uri.scheme === 'file' && process.platform === 'win32',
  );
}

function affectsReadonlyConfiguration(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration('files.readonlyInclude')
    || event.affectsConfiguration('files.readonlyExclude')
    || event.affectsConfiguration('files.readonlyFromPermissions');
}

function fileSystemErrorCode(error: unknown): string | undefined {
  if (error instanceof vscode.FileSystemError) return error.code;
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function resourceParentUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({
    path: path.posix.dirname(uri.path),
    query: '',
    fragment: '',
  });
}

function resourceWatchKey(uri: vscode.Uri): string {
  return uri.with({ query: '', fragment: '' }).toString();
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

function readSearchVisible(context: vscode.ExtensionContext): boolean {
  if (!shouldRememberState()) return readDefaultSearchVisible();
  const value = context.workspaceState.get<boolean>(SEARCH_VISIBLE_STORAGE_KEY);
  return typeof value === 'boolean' ? value : readDefaultSearchVisible();
}

function readSearchGroups(context: vscode.ExtensionContext): boolean {
  if (!shouldRememberState()) return readDefaultSearchGroups();
  const value = context.workspaceState.get<boolean>(SEARCH_GROUPS_STORAGE_KEY);
  return typeof value === 'boolean' ? value : readDefaultSearchGroups();
}

function readDefaultSearchVisible(): boolean {
  return true;
}

function readDefaultSearchGroups(): boolean {
  return false;
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

function readRailPosition(): RailPosition {
  const value = vscode.workspace.getConfiguration('verticalTabs').get<unknown>('position', 'left');
  return value === 'right' ? 'right' : 'left';
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

function readRelativePathDisplay(): RelativePathDisplay {
  const value = vscode.workspace.getConfiguration('verticalTabs').get<RelativePathDisplay>('relativePathDisplay', 'off');
  return isRelativePathDisplay(value) ? value : 'off';
}

function readToolbarPosition(): ToolbarPosition {
  const value = vscode.workspace.getConfiguration('verticalTabs').get<unknown>('toolbarPosition', 'top');
  return value === 'bottom' ? 'bottom' : 'top';
}

function readAlwaysFollowActiveTab(): boolean {
  return vscode.workspace.getConfiguration('verticalTabs').get<boolean>('alwaysFollowActiveTab', true);
}

function readNativeContextMenuActionsEnabled(): boolean {
  return vscode.workspace.getConfiguration('verticalTabs').get<boolean>('showNativeContextMenuActions', true);
}

function isGroupMode(value: unknown): value is GroupMode {
  return value === 'manual' || value === 'parentDir' || value === 'fileType' || value === 'vscode';
}

function isRelativePathDisplay(value: unknown): value is RelativePathDisplay {
  return value === 'off'
    || value === 'duplicatesDirectory'
    || value === 'duplicates'
    || value === 'alwaysDirectory'
    || value === 'always';
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'mru' || value === 'modifiedAsc' || value === 'modifiedDesc' || value === 'nameAsc' || value === 'nameDesc' || value === 'none';
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
