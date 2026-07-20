export type TabTargetIdentity =
  | { readonly kind: 'text' | 'custom' | 'notebook'; readonly uri: string }
  | { readonly kind: 'diff' | 'notebookDiff'; readonly originalUri: string; readonly modifiedUri: string }
  | { readonly kind: 'webview'; readonly viewType: string; readonly label: string }
  | { readonly kind: 'terminal' | 'unknown'; readonly label: string };
export interface TabTarget { readonly revision: number; readonly groupIndex: number; readonly tabIndex: number; readonly identity: TabTargetIdentity; }
export type GroupMode = 'vscode' | 'manual' | 'parentDir' | 'fileType';
export type SortMode = 'none' | 'modifiedAsc' | 'modifiedDesc' | 'nameAsc' | 'nameDesc';
export type TabActivationKind = 'reliable' | 'bestEffort' | 'unsupported';
export interface VerticalTabItem {
  readonly target: TabTarget; readonly label: string; readonly description?: string; readonly isActive: boolean;
  readonly isDirty: boolean; readonly isPinned: boolean; readonly isPreview: boolean; readonly isActivatable: boolean; readonly activationKind: TabActivationKind; readonly manualGroupId?: string;
  readonly groupId?: string; readonly isFile: boolean; readonly resourcePath?: string; readonly mtime?: number;
}
export interface ManualTabGroup { readonly id: string; readonly name: string; readonly collapsed: boolean; }
export interface VerticalTabDisplayGroup {
  readonly id: string; readonly title: string; readonly description?: string; readonly collapsed: boolean;
  readonly mode: GroupMode; readonly tabs: readonly VerticalTabItem[]; readonly showHeader: boolean; readonly isManual: boolean;
}
export interface VerticalTabsSnapshot {
  readonly revision: number; readonly groupMode: GroupMode; readonly sortMode: SortMode;
  readonly tabs: readonly VerticalTabItem[]; readonly manualGroups: readonly ManualTabGroup[]; readonly displayGroups: readonly VerticalTabDisplayGroup[];
}
export type WebviewMessage =
  | { readonly type: 'ready' } | { readonly type: 'requestRefresh' } | { readonly type: 'closeSaved' }
  | { readonly type: 'webviewLog'; readonly level: 'debug' | 'warn' | 'error'; readonly message: string; readonly details?: string }
  | { readonly type: 'closeAll' } | { readonly type: 'setGroupMode'; readonly groupMode: GroupMode }
  | { readonly type: 'setSortMode'; readonly sortMode: SortMode }
  | { readonly type: 'railWidth'; readonly width: number } | { readonly type: 'createGroup'; readonly name: string }
  | { readonly type: 'renameGroup'; readonly groupId: string; readonly name: string } | { readonly type: 'deleteGroup'; readonly groupId: string }
  | { readonly type: 'toggleGroup'; readonly groupId: string } | { readonly type: 'assignGroup'; readonly target: TabTarget; readonly groupId?: string }
  | { readonly type: 'pinTab' | 'unpinTab'; readonly target: TabTarget }
  | { readonly type: 'moveTab'; readonly target: TabTarget; readonly groupId?: string; readonly beforeTarget?: TabTarget }
  | { readonly type: 'reorderManualTab'; readonly target: TabTarget; readonly groupId?: string; readonly beforeTarget?: TabTarget }
  | { readonly type: 'createGroupFromTabs'; readonly source: TabTarget; readonly target: TabTarget }
  | { readonly type: 'moveToPreviousGroup' | 'moveToNextGroup' | 'moveToNewGroup'; readonly target: TabTarget }
  | { readonly type: 'activateTab' | 'closeTab' | 'closeOthers' | 'closeBelow'; readonly target: TabTarget };
export type ExtensionMessage = { readonly type: 'renderTabs'; readonly title: string; readonly snapshot: VerticalTabsSnapshot };

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready' || value.type === 'requestRefresh' || value.type === 'closeSaved' || value.type === 'closeAll') return { type: value.type };
  if (value.type === 'webviewLog' && isWebviewLogLevel(value.level) && isLogMessage(value.message) && (value.details === undefined || isLogDetails(value.details))) {
    return { type: 'webviewLog', level: value.level, message: value.message, ...(value.details === undefined ? {} : { details: value.details }) };
  }
  if (value.type === 'setGroupMode' && isGroupMode(value.groupMode)) return { type: 'setGroupMode', groupMode: value.groupMode };
  if (value.type === 'setSortMode' && isSortMode(value.sortMode)) return { type: 'setSortMode', sortMode: value.sortMode };
  if (value.type === 'railWidth' && isRailWidth(value.width)) return { type: 'railWidth', width: value.width };
  if (value.type === 'createGroup' && isName(value.name)) return { type: 'createGroup', name: value.name };
  if ((value.type === 'renameGroup') && isId(value.groupId) && isName(value.name)) return { type: 'renameGroup', groupId: value.groupId, name: value.name };
  if ((value.type === 'deleteGroup' || value.type === 'toggleGroup') && isId(value.groupId)) return { type: value.type, groupId: value.groupId };
  if (value.type === 'assignGroup' && isTabTarget(value.target) && (value.groupId === undefined || isId(value.groupId))) return { type: 'assignGroup', target: value.target, ...(value.groupId === undefined ? {} : { groupId: value.groupId }) };
  if ((value.type === 'pinTab' || value.type === 'unpinTab') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  if ((value.type === 'moveTab' || value.type === 'reorderManualTab') && isTabTarget(value.target) && (value.groupId === undefined || isId(value.groupId)) && (value.beforeTarget === undefined || isTabTarget(value.beforeTarget))) {
    return { type: value.type, target: value.target, ...(value.groupId === undefined ? {} : { groupId: value.groupId }), ...(value.beforeTarget === undefined ? {} : { beforeTarget: value.beforeTarget }) };
  }
  if (value.type === 'createGroupFromTabs' && isTabTarget(value.source) && isTabTarget(value.target)) return { type: 'createGroupFromTabs', source: value.source, target: value.target };
  if ((value.type === 'moveToPreviousGroup' || value.type === 'moveToNextGroup' || value.type === 'moveToNewGroup') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  if ((value.type === 'activateTab' || value.type === 'closeTab' || value.type === 'closeOthers' || value.type === 'closeBelow') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isGroupMode(value: unknown): value is GroupMode { return value === 'vscode' || value === 'manual' || value === 'parentDir' || value === 'fileType'; }
function isSortMode(value: unknown): value is SortMode { return value === 'none' || value === 'modifiedAsc' || value === 'modifiedDesc' || value === 'nameAsc' || value === 'nameDesc'; }
function isWebviewLogLevel(value: unknown): value is 'debug' | 'warn' | 'error' { return value === 'debug' || value === 'warn' || value === 'error'; }
function isRailWidth(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 180 && value <= 10000; }
function isName(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80; }
function isId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value); }
function isLogMessage(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 200; }
function isLogDetails(value: unknown): value is string { return typeof value === 'string' && value.length <= 2000; }
function isTabTarget(value: unknown): value is TabTarget {
  return isRecord(value)
    && isNonNegativeInteger(value.revision)
    && isNonNegativeInteger(value.groupIndex)
    && isNonNegativeInteger(value.tabIndex)
    && isTabTargetIdentity(value.identity);
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
