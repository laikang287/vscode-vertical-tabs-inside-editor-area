import type {
  TabTarget,
  TabTargetIdentity,
  VerticalTabDisplayGroup,
  VerticalTabItem,
  VerticalTabsSnapshot,
} from '../webview/messages';

export type TabCommandDirection = -1 | 1;
export type TabNavigationScope = 'group' | 'all';

export interface DisplayTabMovePlan {
  readonly group: VerticalTabDisplayGroup;
  readonly movedTabs: readonly VerticalTabItem[];
  readonly desiredTabs: readonly VerticalTabItem[];
  readonly changed: boolean;
}

/** Returns the adjacent index with wraparound, or -1 when the list is empty. */
export function adjacentCyclicIndex(length: number, currentIndex: number, direction: TabCommandDirection): number {
  if (length <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= length) return direction < 0 ? length - 1 : 0;
  return (currentIndex + direction + length) % length;
}

/**
 * Moves every selected item one position while preserving the selected items'
 * relative order. Adjacent selected items move as one block.
 */
export function moveItemsOneStep<T>(
  order: readonly T[],
  selectedItems: readonly T[],
  direction: TabCommandDirection,
): T[] {
  const result = [...order];
  const selected = new Set(selectedItems);
  if (direction < 0) {
    for (let index = 1; index < result.length; index += 1) {
      if (selected.has(result[index]!) && !selected.has(result[index - 1]!)) {
        [result[index - 1], result[index]] = [result[index]!, result[index - 1]!];
      }
    }
    return result;
  }

  for (let index = result.length - 2; index >= 0; index -= 1) {
    if (selected.has(result[index]!) && !selected.has(result[index + 1]!)) {
      [result[index], result[index + 1]] = [result[index + 1]!, result[index]!];
    }
  }
  return result;
}

/**
 * Resolves a snapshot target to one displayed occurrence. The native editor
 * group remains part of the occurrence identity so duplicate resources opened
 * in different groups do not collapse into one command target.
 */
export function resolveDisplayedTab(
  snapshot: VerticalTabsSnapshot,
  target: TabTarget,
): VerticalTabItem | undefined {
  const exact = displayedTabs(snapshot).find((tab) => sameTargetOccurrence(tab.target, target));
  if (exact) return exact;

  const identityMatches = displayedTabs(snapshot).filter((tab) => sameTargetIdentity(tab.target, target));
  return identityMatches.length === 1 ? identityMatches[0] : undefined;
}

export function displayGroupForTarget(
  snapshot: VerticalTabsSnapshot,
  target: TabTarget,
): VerticalTabDisplayGroup | undefined {
  const resolved = resolveDisplayedTab(snapshot, target);
  if (!resolved) return undefined;
  return snapshot.displayGroups.find((group) => group.tabs.includes(resolved));
}

/**
 * Finds the previous/next activatable tab using the order rendered by the
 * vertical tab bar. Unsupported tabs remain in the ordering but are skipped as
 * focus destinations. Navigation stops at the list boundary, matching the
 * vertical tab tree's ArrowUp and ArrowDown behavior.
 */
export function adjacentDisplayedTabTarget(
  snapshot: VerticalTabsSnapshot,
  anchor: TabTarget | undefined,
  direction: TabCommandDirection,
  scope: TabNavigationScope,
): TabTarget | undefined {
  const anchorGroup = anchor ? displayGroupForTarget(snapshot, anchor) : undefined;
  const candidates = scope === 'group' && anchorGroup
    ? [...anchorGroup.tabs]
    : displayedTabs(snapshot);
  if (candidates.length === 0) return undefined;

  const resolvedAnchor = anchor ? resolveDisplayedTab(snapshot, anchor) : undefined;
  const anchorIndex = resolvedAnchor ? candidates.indexOf(resolvedAnchor) : -1;
  let index = anchorIndex < 0
    ? (direction < 0 ? candidates.length : -1)
    : anchorIndex;
  while (true) {
    index += direction;
    if (index < 0 || index >= candidates.length) return undefined;
    const candidate = candidates[index];
    if (candidate?.isActivatable) return candidate.target;
  }
}

/**
 * Returns only the selected tabs that belong to the anchor's displayed group.
 * When the anchor is not part of a multi-selection the command operates on the
 * anchor alone.
 */
export function selectedDisplayedTabsInAnchorGroup(
  snapshot: VerticalTabsSnapshot,
  anchor: TabTarget,
  selectedTargets: readonly TabTarget[],
): readonly VerticalTabItem[] {
  const anchorTab = resolveDisplayedTab(snapshot, anchor);
  const group = displayGroupForTarget(snapshot, anchor);
  if (!anchorTab || !group) return [];

  const selected = selectedTargets
    .map((target) => resolveDisplayedTab(snapshot, target))
    .filter((tab): tab is VerticalTabItem => tab !== undefined && group.tabs.includes(tab));
  const selectedSet = new Set(selected);
  if (selected.length <= 1 || !selectedSet.has(anchorTab)) return [anchorTab];
  return group.tabs.filter((tab) => selectedSet.has(tab));
}

/**
 * Plans a one-step move in the current displayed group. Pinned and unpinned
 * tabs are separate fixed partitions, matching the rendered ordering.
 */
export function planDisplayedTabMove(
  snapshot: VerticalTabsSnapshot,
  anchor: TabTarget,
  selectedTargets: readonly TabTarget[],
  direction: TabCommandDirection,
): DisplayTabMovePlan | undefined {
  const group = displayGroupForTarget(snapshot, anchor);
  if (!group) return undefined;
  const movedTabs = selectedDisplayedTabsInAnchorGroup(snapshot, anchor, selectedTargets);
  if (movedTabs.length === 0) return undefined;

  const movedSet = new Set(movedTabs);
  const pinned = group.tabs.filter((tab) => tab.isPinned);
  const unpinned = group.tabs.filter((tab) => !tab.isPinned);
  const desiredTabs = [
    ...moveItemsOneStep(pinned, pinned.filter((tab) => movedSet.has(tab)), direction),
    ...moveItemsOneStep(unpinned, unpinned.filter((tab) => movedSet.has(tab)), direction),
  ];
  return {
    group,
    movedTabs,
    desiredTabs,
    changed: desiredTabs.some((tab, index) => tab !== group.tabs[index]),
  };
}

/** Returns the adjacent displayed group without wrapping. */
export function adjacentDisplayedGroup(
  snapshot: VerticalTabsSnapshot,
  anchor: TabTarget,
  direction: TabCommandDirection,
): VerticalTabDisplayGroup | undefined {
  const group = displayGroupForTarget(snapshot, anchor);
  const index = group ? snapshot.displayGroups.indexOf(group) : -1;
  return index < 0 ? undefined : snapshot.displayGroups[index + direction];
}

function displayedTabs(snapshot: VerticalTabsSnapshot): VerticalTabItem[] {
  return snapshot.displayGroups.flatMap((group) => [...group.tabs]);
}

function sameTargetOccurrence(left: TabTarget, right: TabTarget): boolean {
  return left.groupIndex === right.groupIndex && sameTargetIdentity(left, right);
}

function sameTargetIdentity(left: TabTarget, right: TabTarget): boolean {
  return sameIdentity(left.identity, right.identity);
}

function sameIdentity(left: TabTargetIdentity, right: TabTargetIdentity): boolean {
  if (left.kind !== right.kind) return false;
  if ((left.kind === 'text' || left.kind === 'custom' || left.kind === 'notebook')
    && (right.kind === 'text' || right.kind === 'custom' || right.kind === 'notebook')) {
    return left.uri === right.uri;
  }
  if ((left.kind === 'diff' || left.kind === 'notebookDiff')
    && (right.kind === 'diff' || right.kind === 'notebookDiff')) {
    return left.originalUri === right.originalUri && left.modifiedUri === right.modifiedUri;
  }
  if (left.kind === 'webview' && right.kind === 'webview') {
    return left.viewType === right.viewType && left.label === right.label;
  }
  return (left.kind === 'terminal' || left.kind === 'unknown')
    && (right.kind === 'terminal' || right.kind === 'unknown')
    && left.label === right.label;
}
