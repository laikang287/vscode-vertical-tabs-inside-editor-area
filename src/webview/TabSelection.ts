import type { VerticalTabItem } from './messages';

export interface SelectionModifiers {
  readonly shiftKey: boolean;
  readonly toggleKey: boolean;
}

/** Keeps Webview-only multi-selection state independent from the active VS Code editor. */
export class TabSelection {
  private readonly selectedKeys = new Set<string>();
  private anchorKey: string | undefined;

  isSelected(tab: VerticalTabItem): boolean {
    return this.selectedKeys.has(selectionKey(tab));
  }

  selectSingle(tab: VerticalTabItem): void {
    const key = selectionKey(tab);
    this.selectedKeys.clear();
    this.selectedKeys.add(key);
    this.anchorKey = key;
  }

  update(visibleTabs: readonly VerticalTabItem[], tab: VerticalTabItem, modifiers: SelectionModifiers): void {
    const key = selectionKey(tab);
    if (modifiers.shiftKey) {
      const anchorIndex = this.anchorKey ? visibleTabs.findIndex((candidate) => selectionKey(candidate) === this.anchorKey) : -1;
      const targetIndex = visibleTabs.findIndex((candidate) => selectionKey(candidate) === key);
      this.selectedKeys.clear();
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        for (const candidate of visibleTabs.slice(start, end + 1)) this.selectedKeys.add(selectionKey(candidate));
      } else {
        this.selectedKeys.add(key);
        this.anchorKey = key;
      }
      return;
    }

    if (modifiers.toggleKey) {
      if (this.selectedKeys.has(key)) this.selectedKeys.delete(key);
      else this.selectedKeys.add(key);
      this.anchorKey = key;
      return;
    }

    this.selectSingle(tab);
  }

  selectedTabs(allTabs: readonly VerticalTabItem[], fallback: VerticalTabItem): readonly VerticalTabItem[] {
    if (!this.isSelected(fallback)) return [fallback];
    const selected = allTabs.filter((candidate) => this.isSelected(candidate));
    return selected.length > 0 ? selected : [fallback];
  }

  prune(availableTabs: readonly VerticalTabItem[]): void {
    const available = new Set(availableTabs.map(selectionKey));
    for (const key of this.selectedKeys) {
      if (!available.has(key)) this.selectedKeys.delete(key);
    }
    if (this.anchorKey && !available.has(this.anchorKey)) this.anchorKey = undefined;
  }

  keys(): readonly string[] {
    return Array.from(this.selectedKeys);
  }
}

export function selectionKey(tab: VerticalTabItem): string {
  // Identity alone is not enough: VS Code can show the same resource in more
  // than one editor group. The source group keeps those occurrences distinct
  // while remaining stable when a tab is reordered within its group.
  return JSON.stringify([tab.target.identity, tab.target.groupIndex]);
}
