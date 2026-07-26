export type TabListFocusSource = 'editor' | 'outside';

export interface TabListFocusCandidate<T> {
  readonly item: T;
  readonly activatable: boolean;
  readonly groupIndex: number;
  readonly tabIndex: number;
  readonly isActiveInGroup: boolean;
  readonly isActiveGroup: boolean;
  readonly isLastFocusedGroup: boolean;
  readonly lastActivatedAt?: number;
}

export function selectTabListFocusCandidate<T>(
  candidates: readonly TabListFocusCandidate<T>[],
  source: TabListFocusSource,
  preferredItem?: T,
): T | undefined {
  const eligible = candidates
    .filter((candidate) => candidate.activatable)
    .slice()
    .sort((left, right) => left.groupIndex - right.groupIndex || left.tabIndex - right.tabIndex);

  const preferred = eligible.find((candidate) => candidate.item === preferredItem);
  if (preferred) return preferred.item;

  if (source === 'editor') {
    const activeEditorTab = eligible.find((candidate) => candidate.isActiveGroup && candidate.isActiveInGroup);
    if (activeEditorTab) return activeEditorTab.item;
  }

  const mostRecent = eligible.reduce<TabListFocusCandidate<T> | undefined>((selected, candidate) => {
    if (candidate.lastActivatedAt === undefined) return selected;
    if (!selected || selected.lastActivatedAt === undefined || candidate.lastActivatedAt > selected.lastActivatedAt) {
      return candidate;
    }
    return selected;
  }, undefined);
  if (mostRecent) return mostRecent.item;

  return eligible.find((candidate) => candidate.isLastFocusedGroup && candidate.isActiveInGroup)?.item
    ?? eligible.find((candidate) => candidate.isActiveGroup && candidate.isActiveInGroup)?.item
    ?? eligible.find((candidate) => candidate.isActiveInGroup)?.item
    ?? eligible[0]?.item;
}
