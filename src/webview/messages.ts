export type TabTargetIdentity =
  | { readonly kind: 'text' | 'custom' | 'notebook'; readonly uri: string }
  | { readonly kind: 'diff' | 'notebookDiff'; readonly originalUri: string; readonly modifiedUri: string }
  | { readonly kind: 'webview'; readonly viewType: string; readonly label: string }
  | { readonly kind: 'terminal' | 'unknown'; readonly label: string };
export interface TabTarget { readonly revision: number; readonly groupIndex: number; readonly tabIndex: number; readonly identity: TabTargetIdentity; }
export type GroupMode = 'vscode' | 'manual' | 'parentDir' | 'fileType';
export type SortMode = 'none' | 'mru' | 'modifiedAsc' | 'modifiedDesc' | 'nameAsc' | 'nameDesc';
export type RelativePathDisplay = 'off' | 'duplicatesDirectory' | 'duplicates' | 'alwaysDirectory' | 'always';
export type ToolbarPosition = 'top' | 'bottom';
export type TabActivationKind = 'reliable' | 'bestEffort' | 'unsupported';
export type TabActivationFocus = 'editor' | 'rail';
export type TabInputKind = 'text' | 'diff' | 'custom' | 'notebook' | 'notebookDiff' | 'webview' | 'terminal' | 'unknown';
export type TabResourceStatus = 'readonly' | 'missing' | 'noPermissions' | 'unavailable';
export interface VerticalTabItem {
  readonly target: TabTarget; readonly label: string; readonly description?: string; readonly isActive: boolean; readonly isFocused: boolean;
  readonly isDirty: boolean; readonly isPinned: boolean; readonly isPreview: boolean; readonly isActivatable: boolean; readonly activationKind: TabActivationKind; readonly manualGroupId?: string;
  readonly groupId?: string; readonly isFile: boolean; readonly inputKind: TabInputKind; readonly resourceStatus?: TabResourceStatus;
  readonly resourcePath?: string; readonly workspaceRelativePath?: string; readonly tooltipPath?: string; readonly mtime?: number; readonly lastActivatedAt?: number;
}
export interface ManualTabGroup { readonly id: string; readonly name: string; readonly collapsed: boolean; }
export interface VerticalTabDisplayGroup {
  readonly id: string; readonly title: string; readonly description?: string; readonly collapsed: boolean;
  readonly mode: GroupMode; readonly tabs: readonly VerticalTabItem[]; readonly showHeader: boolean; readonly isManual: boolean;
  readonly isPinned: boolean;
}
export interface VerticalTabsSnapshot {
  readonly revision: number; readonly groupMode: GroupMode; readonly sortMode: SortMode; readonly toolbarPosition: ToolbarPosition; readonly rememberState: boolean; readonly toolbarControlsVisible: boolean;
  readonly tabs: readonly VerticalTabItem[]; readonly manualGroups: readonly ManualTabGroup[]; readonly displayGroups: readonly VerticalTabDisplayGroup[];
  readonly searchVisible: boolean; readonly searchGroups: boolean; readonly alwaysFollowActiveTab: boolean; readonly nativeContextMenuActionsEnabled: boolean; readonly compactContextSubmenusEnabled: boolean;
  readonly collapsedGroupKeys?: readonly string[];
}
export type NativeContextMenuEntry =
  | { readonly kind: 'separator' }
  | { readonly kind: 'action'; readonly actionId: string; readonly label: string; readonly enabled: boolean }
  | { readonly kind: 'submenu'; readonly label: string; readonly entries: readonly NativeContextMenuEntry[] };
export type WebviewMessage =
  | { readonly type: 'ready'; readonly collapsedGroupKeys?: readonly string[] } | { readonly type: 'requestRefresh' } | { readonly type: 'closeSaved' }
  | { readonly type: 'selectionChanged'; readonly targets: readonly TabTarget[] }
  | { readonly type: 'renderAck'; readonly revision: number }
  | { readonly type: 'webviewLog'; readonly level: 'debug' | 'warn' | 'error'; readonly message: string; readonly details?: string }
  | { readonly type: 'closeAll' } | { readonly type: 'requestCreateGroup' } | { readonly type: 'setGroupMode'; readonly groupMode: GroupMode }
  | { readonly type: 'setSortMode'; readonly sortMode: SortMode }
  | { readonly type: 'setToolbarControlsVisible'; readonly visible: boolean }
  | { readonly type: 'setSearchVisible'; readonly visible: boolean }
  | { readonly type: 'setSearchGroups'; readonly enabled: boolean }
  | { readonly type: 'setCollapsedGroups'; readonly keys: readonly string[] }
  | { readonly type: 'manageWorksets' }
  | { readonly type: 'railWidth'; readonly width: number } | { readonly type: 'createGroup'; readonly name: string }
  | { readonly type: 'renameGroup'; readonly groupId: string; readonly name: string } | { readonly type: 'deleteGroup' | 'closeGroup'; readonly groupId: string }
  | { readonly type: 'toggleGroup'; readonly groupId: string } | { readonly type: 'assignGroup'; readonly target: TabTarget; readonly groupId?: string }
  | { readonly type: 'pinTab' | 'unpinTab'; readonly target: TabTarget }
  | { readonly type: 'pinTabs' | 'unpinTabs' | 'closeTabs' | 'closeOthersForTabs' | 'closeBelowForTabs'; readonly targets: readonly TabTarget[] }
  | { readonly type: 'pinGroup' | 'unpinGroup'; readonly groupId: string }
  | { readonly type: 'moveTab'; readonly target: TabTarget; readonly groupId?: string; readonly beforeTarget?: TabTarget }
  | { readonly type: 'moveTabs'; readonly targets: readonly TabTarget[]; readonly groupId?: string; readonly beforeTarget?: TabTarget }
  | { readonly type: 'reorderManualTab'; readonly target: TabTarget; readonly groupId?: string; readonly beforeTarget?: TabTarget }
  | { readonly type: 'createGroupFromTabs'; readonly source: TabTarget; readonly target: TabTarget }
  | { readonly type: 'moveToPreviousGroup' | 'moveToNextGroup' | 'moveToNewGroup'; readonly target: TabTarget }
  | { readonly type: 'moveToGroup'; readonly target: TabTarget; readonly groupIndex: number }
  | { readonly type: 'reorderManualGroup'; readonly groupId: string; readonly beforeGroupId?: string }
  | { readonly type: 'requestNativeTabMenu'; readonly requestId: string; readonly target: TabTarget; readonly targets: readonly TabTarget[] }
  | { readonly type: 'runNativeTabMenuAction'; readonly actionId: string; readonly target: TabTarget; readonly targets: readonly TabTarget[] }
  | { readonly type: 'activateTab'; readonly target: TabTarget; readonly requestId?: string; readonly focus?: TabActivationFocus }
  | { readonly type: 'closeTab' | 'closeOthers' | 'closeBelow'; readonly target: TabTarget };
export type ExtensionMessage =
  | { readonly type: 'renderTabs'; readonly title: string; readonly snapshot: VerticalTabsSnapshot }
  | { readonly type: 'nativeTabMenu'; readonly requestId: string; readonly entries: readonly NativeContextMenuEntry[] }
  | { readonly type: 'previewTabNavigation'; readonly target: TabTarget }
  | { readonly type: 'clearTabNavigationPreview' }
  | { readonly type: 'focusTabList' }
  | { readonly type: 'blurTabList' };
const MAX_BATCH_TAB_TARGETS = 2000;

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready' && (value.collapsedGroupKeys === undefined || isCollapsedGroupKeys(value.collapsedGroupKeys))) {
    return { type: 'ready', ...(value.collapsedGroupKeys === undefined ? {} : { collapsedGroupKeys: value.collapsedGroupKeys }) };
  }
  if (value.type === 'requestRefresh' || value.type === 'closeSaved' || value.type === 'closeAll' || value.type === 'requestCreateGroup' || value.type === 'manageWorksets') return { type: value.type };
  if (value.type === 'selectionChanged' && isTabTargetArray(value.targets)) return { type: 'selectionChanged', targets: value.targets };
  if (value.type === 'renderAck' && isNonNegativeInteger(value.revision)) return { type: 'renderAck', revision: value.revision };
  if (value.type === 'webviewLog' && isWebviewLogLevel(value.level) && isLogMessage(value.message) && (value.details === undefined || isLogDetails(value.details))) {
    return { type: 'webviewLog', level: value.level, message: value.message, ...(value.details === undefined ? {} : { details: value.details }) };
  }
  if (value.type === 'setGroupMode' && isGroupMode(value.groupMode)) return { type: 'setGroupMode', groupMode: value.groupMode };
  if (value.type === 'setSortMode' && isSortMode(value.sortMode)) return { type: 'setSortMode', sortMode: value.sortMode };
  if (value.type === 'setToolbarControlsVisible' && typeof value.visible === 'boolean') return { type: 'setToolbarControlsVisible', visible: value.visible };
  if (value.type === 'setSearchVisible' && typeof value.visible === 'boolean') return { type: 'setSearchVisible', visible: value.visible };
  if (value.type === 'setSearchGroups' && typeof value.enabled === 'boolean') return { type: 'setSearchGroups', enabled: value.enabled };
  if (value.type === 'setCollapsedGroups' && isCollapsedGroupKeys(value.keys)) return { type: 'setCollapsedGroups', keys: value.keys };
  if (value.type === 'railWidth' && isRailWidth(value.width)) return { type: 'railWidth', width: value.width };
  if (value.type === 'createGroup' && isName(value.name)) return { type: 'createGroup', name: value.name };
  if ((value.type === 'renameGroup') && isId(value.groupId) && isName(value.name)) return { type: 'renameGroup', groupId: value.groupId, name: value.name };
  if ((value.type === 'deleteGroup' || value.type === 'toggleGroup') && isId(value.groupId)) return { type: value.type, groupId: value.groupId };
  if ((value.type === 'closeGroup' || value.type === 'pinGroup' || value.type === 'unpinGroup') && isDisplayGroupId(value.groupId)) return { type: value.type, groupId: value.groupId };
  if (value.type === 'assignGroup' && isTabTarget(value.target) && (value.groupId === undefined || isId(value.groupId))) return { type: 'assignGroup', target: value.target, ...(value.groupId === undefined ? {} : { groupId: value.groupId }) };
  if ((value.type === 'pinTab' || value.type === 'unpinTab') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  if ((value.type === 'pinTabs' || value.type === 'unpinTabs' || value.type === 'closeTabs' || value.type === 'closeOthersForTabs' || value.type === 'closeBelowForTabs') && isTabTargets(value.targets)) return { type: value.type, targets: value.targets };
  if ((value.type === 'moveTab' || value.type === 'reorderManualTab') && isTabTarget(value.target) && (value.groupId === undefined || isMoveDisplayGroupId(value.groupId)) && (value.beforeTarget === undefined || isTabTarget(value.beforeTarget))) {
    return { type: value.type, target: value.target, ...(value.groupId === undefined ? {} : { groupId: value.groupId }), ...(value.beforeTarget === undefined ? {} : { beforeTarget: value.beforeTarget }) };
  }
  if (value.type === 'moveTabs' && isTabTargets(value.targets) && (value.groupId === undefined || isMoveDisplayGroupId(value.groupId)) && (value.beforeTarget === undefined || isTabTarget(value.beforeTarget))) {
    return { type: 'moveTabs', targets: value.targets, ...(value.groupId === undefined ? {} : { groupId: value.groupId }), ...(value.beforeTarget === undefined ? {} : { beforeTarget: value.beforeTarget }) };
  }
  if (value.type === 'createGroupFromTabs' && isTabTarget(value.source) && isTabTarget(value.target)) return { type: 'createGroupFromTabs', source: value.source, target: value.target };
  if ((value.type === 'moveToPreviousGroup' || value.type === 'moveToNextGroup' || value.type === 'moveToNewGroup') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  if (value.type === 'reorderManualGroup' && isId(value.groupId) && (value.beforeGroupId === undefined || isId(value.beforeGroupId))) return { type: 'reorderManualGroup', groupId: value.groupId, ...(value.beforeGroupId === undefined ? {} : { beforeGroupId: value.beforeGroupId }) };
  if (value.type === 'moveToGroup' && isTabTarget(value.target) && isNonNegativeInteger(value.groupIndex)) return { type: 'moveToGroup', target: value.target, groupIndex: value.groupIndex };
  if (value.type === 'requestNativeTabMenu' && isRequestId(value.requestId) && isTabTarget(value.target) && isTabTargets(value.targets)) {
    return { type: 'requestNativeTabMenu', requestId: value.requestId, target: value.target, targets: value.targets };
  }
  if (value.type === 'runNativeTabMenuAction' && isActionId(value.actionId) && isTabTarget(value.target) && isTabTargets(value.targets)) {
    return { type: 'runNativeTabMenuAction', actionId: value.actionId, target: value.target, targets: value.targets };
  }
  if (value.type === 'activateTab'
    && isTabTarget(value.target)
    && (value.requestId === undefined || isRequestId(value.requestId))
    && (value.focus === undefined || isTabActivationFocus(value.focus))) {
    return {
      type: 'activateTab',
      target: value.target,
      ...(value.requestId === undefined ? {} : { requestId: value.requestId }),
      ...(value.focus === undefined ? {} : { focus: value.focus }),
    };
  }
  if ((value.type === 'closeTab' || value.type === 'closeOthers' || value.type === 'closeBelow') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isGroupMode(value: unknown): value is GroupMode { return value === 'vscode' || value === 'manual' || value === 'parentDir' || value === 'fileType'; }
function isSortMode(value: unknown): value is SortMode { return value === 'none' || value === 'mru' || value === 'modifiedAsc' || value === 'modifiedDesc' || value === 'nameAsc' || value === 'nameDesc'; }
function isWebviewLogLevel(value: unknown): value is 'debug' | 'warn' | 'error' { return value === 'debug' || value === 'warn' || value === 'error'; }
function isTabActivationFocus(value: unknown): value is TabActivationFocus { return value === 'editor' || value === 'rail'; }
function isRailWidth(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 180 && value <= 10000; }
function isName(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80; }
function isId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value); }
function isDisplayGroupId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value); }
function isMoveDisplayGroupId(value: unknown): value is string {
  return isDisplayGroupId(value) && !value.split(/[\\/]/).some((segment) => segment === '..');
}
function isLogMessage(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function isLogDetails(value: unknown): value is string { return typeof value === 'string' && value.length <= 2000; }
function isRequestId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 80; }
function isActionId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value); }
function isTabTarget(value: unknown): value is TabTarget {
  return isRecord(value)
    && isNonNegativeInteger(value.revision)
    && isNonNegativeInteger(value.groupIndex)
    && isNonNegativeInteger(value.tabIndex)
    && isTabTargetIdentity(value.identity);
}
function isTabTargets(value: unknown): value is readonly TabTarget[] {
  return isTabTargetArray(value) && value.length > 0;
}
function isTabTargetArray(value: unknown): value is readonly TabTarget[] {
  return Array.isArray(value) && value.length <= MAX_BATCH_TAB_TARGETS && value.every(isTabTarget);
}
function isTabTargetIdentity(value: unknown): value is TabTargetIdentity {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if ((value.kind === 'text' || value.kind === 'custom' || value.kind === 'notebook') && isUri(value.uri)) return true;
  if ((value.kind === 'diff' || value.kind === 'notebookDiff') && isUri(value.originalUri) && isUri(value.modifiedUri)) return true;
  if (value.kind === 'webview' && isViewType(value.viewType) && isLabel(value.label)) return true;
  return (value.kind === 'terminal' || value.kind === 'unknown') && isLabel(value.label);
}
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function isUri(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4096; }
function isViewType(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function isLabel(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 500; }
function isCollapsedGroupKeys(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= 2000
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(item));
}
