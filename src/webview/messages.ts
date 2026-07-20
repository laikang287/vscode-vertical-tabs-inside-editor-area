export interface TabTarget { readonly revision: number; readonly groupIndex: number; readonly tabIndex: number; }
export interface VerticalTabItem {
  readonly target: TabTarget; readonly label: string; readonly description?: string; readonly isActive: boolean;
  readonly isDirty: boolean; readonly isPinned: boolean; readonly isPreview: boolean; readonly isActivatable: boolean; readonly manualGroupId?: string;
}
export interface ManualTabGroup { readonly id: string; readonly name: string; readonly collapsed: boolean; }
export interface VerticalTabsSnapshot { readonly revision: number; readonly tabs: readonly VerticalTabItem[]; readonly manualGroups: readonly ManualTabGroup[]; }
export type WebviewMessage =
  | { readonly type: 'ready' } | { readonly type: 'requestRefresh' } | { readonly type: 'closeSaved' }
  | { readonly type: 'railWidth'; readonly width: number } | { readonly type: 'createGroup'; readonly name: string }
  | { readonly type: 'renameGroup'; readonly groupId: string; readonly name: string } | { readonly type: 'deleteGroup'; readonly groupId: string }
  | { readonly type: 'toggleGroup'; readonly groupId: string } | { readonly type: 'assignGroup'; readonly target: TabTarget; readonly groupId?: string }
  | { readonly type: 'activateTab' | 'closeTab' | 'closeOthers' | 'closeBelow'; readonly target: TabTarget };
export type ExtensionMessage = { readonly type: 'renderTabs'; readonly title: string; readonly snapshot: VerticalTabsSnapshot };

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready' || value.type === 'requestRefresh' || value.type === 'closeSaved') return { type: value.type };
  if (value.type === 'railWidth' && isRailWidth(value.width)) return { type: 'railWidth', width: value.width };
  if (value.type === 'createGroup' && isName(value.name)) return { type: 'createGroup', name: value.name };
  if ((value.type === 'renameGroup') && isId(value.groupId) && isName(value.name)) return { type: 'renameGroup', groupId: value.groupId, name: value.name };
  if ((value.type === 'deleteGroup' || value.type === 'toggleGroup') && isId(value.groupId)) return { type: value.type, groupId: value.groupId };
  if (value.type === 'assignGroup' && isTabTarget(value.target) && (value.groupId === undefined || isId(value.groupId))) return { type: 'assignGroup', target: value.target, ...(value.groupId === undefined ? {} : { groupId: value.groupId }) };
  if ((value.type === 'activateTab' || value.type === 'closeTab' || value.type === 'closeOthers' || value.type === 'closeBelow') && isTabTarget(value.target)) return { type: value.type, target: value.target };
  return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isRailWidth(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 180 && value <= 10000; }
function isName(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80; }
function isId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value); }
function isTabTarget(value: unknown): value is TabTarget { return isRecord(value) && isNonNegativeInteger(value.revision) && isNonNegativeInteger(value.groupIndex) && isNonNegativeInteger(value.tabIndex); }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
