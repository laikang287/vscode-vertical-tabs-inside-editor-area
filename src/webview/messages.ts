export interface TabTarget {
  readonly revision: number;
  readonly groupIndex: number;
  readonly tabIndex: number;
}

export interface VerticalTabItem {
  readonly target: TabTarget;
  readonly label: string;
  readonly description?: string;
  readonly isActive: boolean;
  readonly isDirty: boolean;
  readonly isPinned: boolean;
  readonly isPreview: boolean;
  readonly isActivatable: boolean;
}

export interface VerticalTabGroup {
  readonly groupIndex: number;
  readonly viewColumn: number;
  readonly isActive: boolean;
  readonly tabs: readonly VerticalTabItem[];
}

export interface VerticalTabsSnapshot {
  readonly revision: number;
  readonly groups: readonly VerticalTabGroup[];
}

export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'requestRefresh' }
  | { readonly type: 'activateTab'; readonly target: TabTarget }
  | { readonly type: 'closeTab'; readonly target: TabTarget }
  | { readonly type: 'closeOthers'; readonly target: TabTarget }
  | { readonly type: 'closeBelow'; readonly target: TabTarget }
  | { readonly type: 'closeSaved' }
  | { readonly type: 'railWidth'; readonly width: number };

export type ExtensionMessage =
  | { readonly type: 'renderTabs'; readonly title: string; readonly snapshot: VerticalTabsSnapshot };

export function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as { type?: unknown; target?: unknown };
  if (candidate.type === 'ready' || candidate.type === 'requestRefresh' || candidate.type === 'closeSaved') {
    return { type: candidate.type };
  }

  if (candidate.type === 'railWidth' && isRailWidth((candidate as { width?: unknown }).width)) {
    return { type: 'railWidth', width: (candidate as { width: number }).width };
  }

  if (
    (candidate.type === 'activateTab'
      || candidate.type === 'closeTab'
      || candidate.type === 'closeOthers'
      || candidate.type === 'closeBelow')
    && isTabTarget(candidate.target)
  ) {
    return { type: candidate.type, target: candidate.target };
  }

  return undefined;
}

function isRailWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 180 && value <= 10000;
}

function isTabTarget(value: unknown): value is TabTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const target = value as Partial<TabTarget>;
  return isNonNegativeInteger(target.revision)
    && isNonNegativeInteger(target.groupIndex)
    && isNonNegativeInteger(target.tabIndex);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
