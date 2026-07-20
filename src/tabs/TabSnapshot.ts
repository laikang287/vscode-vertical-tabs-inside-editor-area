import type { VerticalTabGroup, VerticalTabItem, VerticalTabsSnapshot } from '../webview/messages';

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
}

export interface SnapshotSourceGroup {
  readonly isActive: boolean;
  readonly viewColumn: number;
  readonly isVerticalTabsGroup?: boolean;
  readonly tabs: readonly SnapshotSourceTab[];
}

export type CloseAction = 'close' | 'closeOthers' | 'closeBelow' | 'closeSaved';

export function buildSnapshot(groups: readonly SnapshotSourceGroup[], revision: number): VerticalTabsSnapshot {
  const visibleTabs = groups.flatMap((group) => group.isVerticalTabsGroup ? [] : group.tabs.filter((tab) => !tab.isVerticalTabsPanel));
  const labelCounts = new Map<string, number>();
  for (const tab of visibleTabs) {
    labelCounts.set(tab.label, (labelCounts.get(tab.label) ?? 0) + 1);
  }

  const snapshotGroups: VerticalTabGroup[] = groups.flatMap((group, groupIndex) => {
    if (group.isVerticalTabsGroup) {
      return [];
    }
    const tabs: VerticalTabItem[] = group.tabs.flatMap((tab, tabIndex) => {
      if (tab.isVerticalTabsPanel) {
        return [];
      }

      return [{
        target: { revision, groupIndex, tabIndex },
        label: tab.label,
        description: labelCounts.get(tab.label) !== 1 ? tab.path : undefined,
        isActive: tab.isActive,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isPreview: tab.isPreview,
        isActivatable: isActivatable(tab.inputKind),
      }];
    });

    if (tabs.length === 0) {
      return [];
    }

    return [{ groupIndex, viewColumn: group.viewColumn, isActive: group.isActive, tabs }];
  });

  return { revision, groups: snapshotGroups };
}

export function selectCloseTargets(
  snapshot: VerticalTabsSnapshot,
  action: CloseAction,
  target?: VerticalTabItem['target'],
): VerticalTabItem['target'][] {
  if (action === 'closeSaved') {
    return snapshot.groups.flatMap((group) => group.tabs
      .filter((tab) => !tab.isDirty && !tab.isPinned)
      .map((tab) => tab.target));
  }

  if (!target) {
    return [];
  }

  const group = snapshot.groups.find((candidate) => candidate.groupIndex === target.groupIndex);
  const index = group?.tabs.findIndex((tab) => sameTarget(tab.target, target)) ?? -1;
  if (!group || index < 0) {
    return [];
  }

  if (action === 'close') {
    return [target];
  }

  const candidates = action === 'closeOthers'
    ? group.tabs.filter((tab) => !sameTarget(tab.target, target))
    : group.tabs.slice(index + 1);

  return candidates.filter((tab) => !tab.isPinned).map((tab) => tab.target);
}

export function sameTarget(
  left: VerticalTabItem['target'],
  right: VerticalTabItem['target'],
): boolean {
  return left.revision === right.revision
    && left.groupIndex === right.groupIndex
    && left.tabIndex === right.tabIndex;
}

function isActivatable(inputKind: TabInputKind): boolean {
  return inputKind === 'text'
    || inputKind === 'diff'
    || inputKind === 'custom'
    || inputKind === 'notebook'
    || inputKind === 'notebookDiff';
}
