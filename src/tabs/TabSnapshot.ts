import type { ManualTabGroup, VerticalTabItem, VerticalTabsSnapshot } from '../webview/messages';

export type TabInputKind = 'text' | 'diff' | 'custom' | 'notebook' | 'notebookDiff' | 'webview' | 'terminal' | 'unknown';

export interface SnapshotSourceTab {
  readonly label: string;
  readonly isActive: boolean;
  readonly isDirty: boolean;
  readonly isPinned: boolean;
  readonly isPreview: boolean;
  readonly inputKind: TabInputKind;
  readonly path?: string;
  readonly isVerticalTabsPanel?: boolean;
  readonly manualGroupId?: string;
}

export interface SnapshotSourceGroup {
  readonly tabs: readonly SnapshotSourceTab[];
}

export type CloseAction = 'close' | 'closeOthers' | 'closeBelow' | 'closeSaved';

/** Builds a flat source snapshot; presentation-only groups belong to this extension. */
export function buildSnapshot(
  groups: readonly SnapshotSourceGroup[],
  revision: number,
  manualGroups: readonly ManualTabGroup[],
): VerticalTabsSnapshot {
  const visibleTabs = groups.flatMap((group) => group.tabs.filter((tab) => !tab.isVerticalTabsPanel));
  const labelCounts = new Map<string, number>();
  for (const tab of visibleTabs) labelCounts.set(tab.label, (labelCounts.get(tab.label) ?? 0) + 1);

  const tabs: VerticalTabItem[] = groups.flatMap((group, groupIndex) => group.tabs.flatMap((tab, tabIndex) => {
    if (tab.isVerticalTabsPanel) return [];
    return [{
      target: { revision, groupIndex, tabIndex },
      label: tab.label,
      description: labelCounts.get(tab.label) !== 1 ? tab.path : undefined,
      isActive: tab.isActive,
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      isActivatable: isActivatable(tab.inputKind),
      manualGroupId: tab.manualGroupId,
    }];
  }));
  return { revision, tabs, manualGroups };
}

export function selectCloseTargets(snapshot: VerticalTabsSnapshot, action: CloseAction, target?: VerticalTabItem['target']): VerticalTabItem['target'][] {
  if (action === 'closeSaved') return snapshot.tabs.filter((tab) => !tab.isDirty && !tab.isPinned).map((tab) => tab.target);
  if (!target) return [];
  const selected = snapshot.tabs.find((tab) => sameTarget(tab.target, target));
  if (!selected) return [];
  if (action === 'close') return [target];
  const bucket = snapshot.tabs.filter((tab) => tab.manualGroupId === selected.manualGroupId);
  const index = bucket.findIndex((tab) => sameTarget(tab.target, target));
  const candidates = action === 'closeOthers' ? bucket.filter((tab) => !sameTarget(tab.target, target)) : bucket.slice(index + 1);
  return candidates.filter((tab) => !tab.isPinned).map((tab) => tab.target);
}

export function sameTarget(left: VerticalTabItem['target'], right: VerticalTabItem['target']): boolean {
  return left.revision === right.revision && left.groupIndex === right.groupIndex && left.tabIndex === right.tabIndex;
}

function isActivatable(inputKind: TabInputKind): boolean {
  return inputKind === 'text' || inputKind === 'diff' || inputKind === 'custom' || inputKind === 'notebook' || inputKind === 'notebookDiff';
}
