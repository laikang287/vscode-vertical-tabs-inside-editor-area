import * as path from 'node:path';
import { format, type LocaleStrings } from '../i18n';
import type {
  GroupMode,
  ManualTabGroup,
  SortMode,
  TabTargetIdentity,
  TabActivationKind,
  ToolbarPosition,
  VerticalTabDisplayGroup,
  VerticalTabItem,
  VerticalTabsSnapshot,
} from '../webview/messages';

export type TabInputKind = 'text' | 'diff' | 'custom' | 'notebook' | 'notebookDiff' | 'webview' | 'terminal' | 'unknown';

export interface SnapshotSourceTab {
  readonly label: string;
  readonly isActive: boolean;
  readonly isFocused?: boolean;
  readonly isDirty: boolean;
  readonly isPinned: boolean;
  readonly isPreview: boolean;
  readonly inputKind: TabInputKind;
  readonly path?: string;
  readonly tooltipPath?: string;
  readonly uri?: string;
  readonly mtime?: number;
  readonly targetIdentity: TabTargetIdentity;
  readonly isActivatable?: boolean;
  readonly isVerticalTabsPanel?: boolean;
  readonly manualGroupId?: string;
}

export interface SnapshotSourceGroup {
  readonly label?: string;
  readonly viewColumn?: number;
  readonly tabs: readonly SnapshotSourceTab[];
}

export interface SnapshotBuildOptions {
  readonly groupMode?: GroupMode;
  readonly sortMode?: SortMode;
  readonly toolbarPosition?: ToolbarPosition;
  readonly rememberState?: boolean;
  readonly toolbarControlsVisible?: boolean;
  readonly searchVisible?: boolean;
  readonly searchGroups?: boolean;
  readonly manualOrderByGroup?: ReadonlyMap<string, readonly string[]>;
  readonly pinnedGroupIds?: ReadonlySet<string>;
  readonly localeStrings?: LocaleStrings;
}

export type CloseAction = 'close' | 'closeOthers' | 'closeBelow' | 'closeSaved' | 'closeAll';

/** Builds a presentation snapshot; VS Code editor groups remain the source of truth. */
export function buildSnapshot(
  groups: readonly SnapshotSourceGroup[],
  revision: number,
  manualGroups: readonly ManualTabGroup[],
  options: SnapshotBuildOptions = {},
): VerticalTabsSnapshot {
  const groupMode = options.groupMode ?? 'vscode';
  const sortMode = options.sortMode ?? 'none';

  const tabs: VerticalTabItem[] = groups.flatMap((group, groupIndex) => group.tabs.flatMap((tab, tabIndex) => {
    if (tab.isVerticalTabsPanel) return [];
    return [{
      target: { revision, groupIndex, tabIndex, identity: tab.targetIdentity },
      label: tab.label,
      isActive: tab.isActive,
      isFocused: Boolean(tab.isFocused),
      isDirty: tab.isDirty,
      isPinned: tab.isPinned,
      isPreview: tab.isPreview,
      activationKind: activationKind(tab),
      isActivatable: activationKind(tab) !== 'unsupported',
      manualGroupId: tab.manualGroupId,
      groupId: tab.manualGroupId,
      isFile: isFileTab(tab),
      resourcePath: tab.path,
      tooltipPath: tab.tooltipPath,
      mtime: tab.mtime,
    }];
  }));

  const displayGroups = buildDisplayGroups(groups, tabs, manualGroups, groupMode, sortMode, options.manualOrderByGroup, options.pinnedGroupIds, options.localeStrings);
  return { revision, groupMode, sortMode, toolbarPosition: options.toolbarPosition ?? 'top', rememberState: options.rememberState ?? true, toolbarControlsVisible: options.toolbarControlsVisible ?? true, searchVisible: options.searchVisible ?? true, searchGroups: options.searchGroups ?? false, tabs, manualGroups, displayGroups };
}

export function selectCloseTargets(snapshot: VerticalTabsSnapshot, action: CloseAction, target?: VerticalTabItem['target']): VerticalTabItem['target'][] {
  if (action === 'closeSaved' || action === 'closeAll') {
    const activeTab = snapshot.tabs.find((tab) => tab.isFocused) ?? snapshot.tabs.find((tab) => tab.isActive);
    if (activeTab) {
      const bucket = findDisplayBucket(snapshot, activeTab);
      if (bucket) {
        const candidates = action === 'closeSaved'
          ? bucket.filter((tab) => !tab.isDirty && !tab.isPinned)
          : bucket.filter((tab) => !tab.isPinned);
        return candidates.map((tab) => tab.target);
      }
    }
    return action === 'closeSaved' ? snapshot.tabs.filter((tab) => !tab.isDirty && !tab.isPinned).map((tab) => tab.target) : snapshot.tabs.filter((tab) => !tab.isPinned).map((tab) => tab.target);
  }
  if (!target) return [];
  const selected = resolveSnapshotTarget(snapshot, target);
  if (!selected) return [];
  if (action === 'close') return [selected.target];
  const bucket = findDisplayBucket(snapshot, selected) ?? snapshot.tabs.filter((tab) => tab.manualGroupId === selected.manualGroupId);
  const index = bucket.findIndex((tab) => sameIdentity(tab.target.identity, selected.target.identity));
  const candidates = action === 'closeOthers' ? bucket.filter((tab) => !sameIdentity(tab.target.identity, selected.target.identity)) : bucket.slice(index + 1);
  return candidates.filter((tab) => !tab.isPinned).map((tab) => tab.target);
}

export function selectCloseTargetsForTabs(snapshot: VerticalTabsSnapshot, action: 'close' | 'closeOthers' | 'closeBelow', targets: readonly VerticalTabItem['target'][]): VerticalTabItem['target'][] {
  const selectedTabs = resolveSnapshotTargets(snapshot, targets);
  if (selectedTabs.length === 0) return [];
  if (action === 'close') return selectedTabs.map((tab) => tab.target);
  const selectedKeys = new Set(selectedTabs.map((tab) => occurrenceKey(tab.target)));
  const result: VerticalTabItem[] = [];
  for (const group of snapshot.displayGroups) {
    const selectedIndexes = group.tabs
      .map((tab, index) => selectedKeys.has(occurrenceKey(tab.target)) ? index : -1)
      .filter((index) => index >= 0);
    if (selectedIndexes.length === 0) continue;
    const candidates = action === 'closeOthers'
      ? group.tabs.filter((tab) => !selectedKeys.has(occurrenceKey(tab.target)))
      : group.tabs.slice(Math.max(...selectedIndexes) + 1);
    result.push(...candidates.filter((tab) => !tab.isPinned));
  }
  return uniqueTargets(result.map((tab) => tab.target));
}

export function sameTarget(left: VerticalTabItem['target'], right: VerticalTabItem['target']): boolean {
  if (left.groupIndex === right.groupIndex && sameIdentity(left.identity, right.identity)) return true;
  return left.revision === right.revision && left.groupIndex === right.groupIndex && left.tabIndex === right.tabIndex;
}

export function sameIdentity(left: TabTargetIdentity, right: TabTargetIdentity): boolean {
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

export function identityKey(identity: TabTargetIdentity): string {
  return JSON.stringify(identity);
}

export function moveItemsBefore<T>(
  order: readonly T[],
  movedItems: readonly T[],
  beforeItem: T | undefined,
): T[] {
  const uniqueMovedItems = Array.from(new Set(movedItems));
  const movedItemSet = new Set(uniqueMovedItems);
  if (beforeItem !== undefined && movedItemSet.has(beforeItem)) return [...order];

  const remaining = order.filter((item) => !movedItemSet.has(item));
  const beforeIndex = beforeItem === undefined ? -1 : remaining.indexOf(beforeItem);
  remaining.splice(beforeIndex >= 0 ? beforeIndex : remaining.length, 0, ...uniqueMovedItems);
  return remaining;
}

function buildDisplayGroups(
  sourceGroups: readonly SnapshotSourceGroup[],
  tabs: readonly VerticalTabItem[],
  manualGroups: readonly ManualTabGroup[],
  groupMode: GroupMode,
  sortMode: SortMode,
  manualOrderByGroup: ReadonlyMap<string, readonly string[]> | undefined,
  pinnedGroupIds: ReadonlySet<string> | undefined,
  localeStrings?: LocaleStrings,
): VerticalTabDisplayGroup[] {
  if (groupMode === 'manual') return orderDisplayGroups(buildManualGroups(tabs, manualGroups, sortMode, manualOrderByGroup, pinnedGroupIds, localeStrings), sortMode);
  if (groupMode === 'parentDir') return orderDisplayGroups(buildAutoGroups(tabs, 'parentDir', sortMode, pinnedGroupIds, localeStrings), sortMode);
  if (groupMode === 'fileType') return orderDisplayGroups(buildAutoGroups(tabs, 'fileType', sortMode, pinnedGroupIds, localeStrings), sortMode);
  return buildVsCodeGroups(sourceGroups, tabs, sortMode, localeStrings);
}

function buildVsCodeGroups(sourceGroups: readonly SnapshotSourceGroup[], tabs: readonly VerticalTabItem[], sortMode: SortMode, localeStrings?: LocaleStrings): VerticalTabDisplayGroup[] {
  const groups: VerticalTabDisplayGroup[] = [];
  for (let sourceIndex = 0; sourceIndex < sourceGroups.length; sourceIndex += 1) {
    const groupTabs = tabs.filter((tab) => tab.target.groupIndex === sourceIndex);
    if (groupTabs.length === 0) continue;
    groups.push({
     id: `vscode-${sourceIndex}`,
      title: format(localeStrings?.editorGroup ?? sourceGroups[sourceIndex]?.label ?? 'Editor Group {0}', groups.length + 1),
     collapsed: false,
      mode: 'vscode',
      tabs: sortTabs(groupTabs, sortMode),
      showHeader: true,
      isManual: false,
      isPinned: false,
    });
  }
  const flattenOnlyUserGroup = sourceGroups.length === 2 && groups.length === 1 && sourceGroups.some(isExtensionOnlyGroup);
  if (flattenOnlyUserGroup) {
    return groups.map((group) => ({ ...group, showHeader: false }));
  }
  return groups;
}

function isExtensionOnlyGroup(group: SnapshotSourceGroup): boolean {
  return group.tabs.length > 0 && group.tabs.every((tab) => tab.isVerticalTabsPanel);
}

function buildManualGroups(
  tabs: readonly VerticalTabItem[],
  manualGroups: readonly ManualTabGroup[],
  sortMode: SortMode,
  manualOrderByGroup: ReadonlyMap<string, readonly string[]> | undefined,
  pinnedGroupIds: ReadonlySet<string> | undefined,
  localeStrings?: LocaleStrings,
): VerticalTabDisplayGroup[] {
  const knownGroups = new Set(manualGroups.map((group) => group.id));
  const ungrouped = orderManualTabs(tabs.filter((tab) => !tab.manualGroupId || !knownGroups.has(tab.manualGroupId)), '__ungrouped', manualOrderByGroup);
  const displayGroups: VerticalTabDisplayGroup[] = [];
  displayGroups.push({
      id: '__ungrouped',
      title: localeStrings?.ungrouped ?? 'Ungrouped',
      collapsed: false,
      mode: 'manual',
      tabs: sortTabs(ungrouped, sortMode),
      showHeader: false,
      isManual: true,
      isPinned: false,
  });
  for (const group of manualGroups) {
    const groupTabs = orderManualTabs(tabs.filter((tab) => tab.manualGroupId === group.id), group.id, manualOrderByGroup);
    displayGroups.push({
      id: group.id,
      title: group.name,
      collapsed: group.collapsed,
      mode: 'manual',
      tabs: sortTabs(groupTabs, sortMode),
      showHeader: true,
      isManual: true,
      isPinned: pinnedGroupIds?.has(group.id) ?? false,
    });
  }
  return displayGroups;
}

function buildAutoGroups(tabs: readonly VerticalTabItem[], groupMode: 'parentDir' | 'fileType', sortMode: SortMode, pinnedGroupIds: ReadonlySet<string> | undefined, localeStrings?: LocaleStrings): VerticalTabDisplayGroup[] {
  const buckets = new Map<string, VerticalTabItem[]>();
  for (const tab of tabs) {
    const id = groupMode === 'parentDir' ? parentDirKey(tab) : fileTypeKey(tab);
    const bucket = buckets.get(id) ?? [];
    bucket.push(tab);
    buckets.set(id, bucket);
  }
  const parentNameCounts = new Map<string, number>();
  if (groupMode === 'parentDir') {
    for (const id of buckets.keys()) {
      const title = parentDirTitle(id, localeStrings);
      parentNameCounts.set(title, (parentNameCounts.get(title) ?? 0) + 1);
    }
  }
  const parentDescriptions = groupMode === 'parentDir'
    ? shortestUniquePathSuffixes(Array.from(buckets.keys()).map((id) => ({ key: id, path: id })))
    : new Map<string, string>();
  return Array.from(buckets.entries()).map(([id, groupTabs]) => {
    const title = groupMode === 'parentDir' ? parentDirTitle(id, localeStrings) : fileTypeTitle(id, localeStrings);
    return {
      id,
      title,
      description: groupMode === 'parentDir' && parentNameCounts.get(title) !== 1 ? parentDescriptions.get(id) : undefined,
      collapsed: false,
      mode: groupMode,
      tabs: sortTabs(groupTabs, sortMode),
      showHeader: true,
      isManual: false,
      isPinned: pinnedGroupIds?.has(id) ?? false,
    };
  });
}

function orderDisplayGroups(groups: VerticalTabDisplayGroup[], sortMode: SortMode): VerticalTabDisplayGroup[] {
  return groups
    .map((group, index) => ({ group, index, sortKey: groupSortKey(group, sortMode) }))
    .sort((left, right) => {
      if (isManualRootDisplayGroup(left.group) !== isManualRootDisplayGroup(right.group)) return isManualRootDisplayGroup(left.group) ? -1 : 1;
      if (left.group.isPinned !== right.group.isPinned) return left.group.isPinned ? -1 : 1;
      if (sortMode !== 'none' && left.sortKey !== undefined && right.sortKey !== undefined) {
        const compared = left.sortKey.localeCompare(right.sortKey, undefined, { numeric: true, sensitivity: 'base' });
        if (compared !== 0) {
          const dir = sortMode === 'nameDesc' || sortMode === 'modifiedDesc' ? -1 : 1;
          return dir * compared;
        }
      }
      return left.index - right.index;
    })
    .map((entry) => entry.group);
}

function groupSortKey(group: VerticalTabDisplayGroup, sortMode: SortMode): string | undefined {
  if (sortMode === 'nameAsc' || sortMode === 'nameDesc') {
    return group.title;
  }
  if (sortMode === 'modifiedAsc' || sortMode === 'modifiedDesc') {
    const latestMtime = group.tabs.reduce((max, tab) => {
      if (!tab.isFile || tab.mtime === undefined) return max;
      return Math.max(max, tab.mtime);
    }, 0);
    if (latestMtime === 0) return undefined;
    return latestMtime.toString().padStart(16, '0');
  }
  return undefined;
}

function isManualRootDisplayGroup(group: VerticalTabDisplayGroup): boolean {
  return group.mode === 'manual' && group.id === '__ungrouped';
}

function shortestUniquePathSuffixes<Key>(items: readonly { readonly key: Key; readonly path: string | undefined }[]): Map<Key, string> {
  const normalizedItems = items.map((item) => ({
    key: item.key,
    segments: pathSegments(item.path),
  }));
  const result = new Map<Key, string>();
  for (const item of normalizedItems) {
    if (item.segments.length === 0) continue;
    let suffixLength = 1;
    while (suffixLength < item.segments.length && normalizedItems.some((other) => other !== item && suffix(other.segments, suffixLength) === suffix(item.segments, suffixLength))) {
      suffixLength += 1;
    }
    result.set(item.key, suffix(item.segments, suffixLength));
  }
  return result;
}

function pathSegments(value: string | undefined): readonly string[] {
  if (!value || value === '__other' || value === '__root') return [];
  return path.posix.normalize(value).split('/').filter((segment) => segment.length > 0 && segment !== '.');
}

function suffix(segments: readonly string[], suffixLength: number): string {
  return segments.slice(Math.max(0, segments.length - suffixLength)).join('/');
}

function sortTabs(tabs: readonly VerticalTabItem[], sortMode: SortMode): readonly VerticalTabItem[] {
  return tabs
    .map((tab, index) => ({ tab, index, fileSort: fileSortValue(tab, sortMode) }))
    .sort((left, right) => {
      if (left.tab.isPinned !== right.tab.isPinned) return left.tab.isPinned ? -1 : 1;
      if (sortMode === 'none') return left.index - right.index;
      if (left.fileSort === undefined || right.fileSort === undefined) return left.index - right.index;
      const compared = left.fileSort.localeCompare(right.fileSort, undefined, { numeric: true, sensitivity: 'base' });
      return compared === 0 ? left.index - right.index : compared;
    })
    .map((entry) => entry.tab);
}

function fileSortValue(tab: VerticalTabItem, sortMode: SortMode): string | undefined {
  if (!tab.isFile) return undefined;
  if (sortMode === 'nameAsc') return tab.label;
  if (sortMode === 'nameDesc') return invertString(tab.label);
  const mtime = readMtime(tab);
  if (mtime === undefined) return undefined;
  const value = sortMode === 'modifiedAsc' ? mtime : Number.MAX_SAFE_INTEGER - mtime;
  return value.toString().padStart(16, '0');
}

function orderManualTabs(tabs: readonly VerticalTabItem[], groupId: string, manualOrderByGroup: ReadonlyMap<string, readonly string[]> | undefined): readonly VerticalTabItem[] {
  const order = manualOrderByGroup?.get(groupId);
  if (!order) return tabs;
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...tabs].sort((left, right) => (rank.get(identityKey(left.target.identity)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(identityKey(right.target.identity)) ?? Number.MAX_SAFE_INTEGER));
}

function findDisplayBucket(snapshot: VerticalTabsSnapshot, selected: VerticalTabItem): readonly VerticalTabItem[] | undefined {
  return snapshot.displayGroups.find((group) => group.tabs.some((tab) => occurrenceKey(tab.target) === occurrenceKey(selected.target)))?.tabs;
}

function resolveSnapshotTargets(snapshot: VerticalTabsSnapshot, targets: readonly VerticalTabItem['target'][]): VerticalTabItem[] {
  const result: VerticalTabItem[] = [];
  for (const target of targets) {
    const tab = resolveSnapshotTarget(snapshot, target);
    if (tab && !result.some((candidate) => occurrenceKey(candidate.target) === occurrenceKey(tab.target))) {
      result.push(tab);
    }
  }
  return result;
}

function uniqueTargets(targets: readonly VerticalTabItem['target'][]): VerticalTabItem['target'][] {
  const result: VerticalTabItem['target'][] = [];
  for (const target of targets) {
    if (!result.some((candidate) => occurrenceKey(candidate) === occurrenceKey(target))) {
      result.push(target);
    }
  }
  return result;
}

function resolveSnapshotTarget(snapshot: VerticalTabsSnapshot, target: VerticalTabItem['target']): VerticalTabItem | undefined {
  const sameGroup = snapshot.tabs.find((candidate) => candidate.target.groupIndex === target.groupIndex && sameIdentity(candidate.target.identity, target.identity));
  if (sameGroup) return sameGroup;
  const identityMatches = snapshot.tabs.filter((candidate) => sameIdentity(candidate.target.identity, target.identity));
  return identityMatches.length === 1 ? identityMatches[0] : undefined;
}

function occurrenceKey(target: VerticalTabItem['target']): string {
  return JSON.stringify([target.identity, target.groupIndex]);
}

function activationKind(tab: SnapshotSourceTab): TabActivationKind {
  if (tab.isActivatable !== undefined) return tab.isActivatable ? 'bestEffort' : 'unsupported';
  if (tab.inputKind === 'text' || tab.inputKind === 'diff' || tab.inputKind === 'custom' || tab.inputKind === 'notebook' || tab.inputKind === 'notebookDiff') {
    return 'reliable';
  }
  if (tab.inputKind === 'webview' || tab.inputKind === 'terminal' || tab.inputKind === 'unknown') {
    return 'bestEffort';
  }
  return 'unsupported';
}

function isFileTab(tab: SnapshotSourceTab): boolean {
  return tab.inputKind === 'text' || tab.inputKind === 'custom' || tab.inputKind === 'notebook' || tab.inputKind === 'diff' || tab.inputKind === 'notebookDiff';
}

function parentDirKey(tab: VerticalTabItem): string {
  const tabPath = path.posix.normalize(extractPath(tab) ?? '');
  if (!tabPath || !tab.isFile) return '__other';
  const dirname = path.posix.dirname(tabPath);
  return dirname === '.' ? '__root' : dirname;
}

function parentDirTitle(id: string, localeStrings?: LocaleStrings): string {
  if (id === '__other') return localeStrings?.other ?? 'Other';
  if (id === '__root') return localeStrings?.workspaceRoot ?? 'Workspace root';
  return path.posix.basename(id);
}

function fileTypeKey(tab: VerticalTabItem): string {
  const tabPath = extractPath(tab);
  if (!tabPath || !tab.isFile) return '__other';
  const extension = path.posix.extname(tabPath || tab.label).toLowerCase();
  return extension || '__none';
}

function fileTypeTitle(id: string, localeStrings?: LocaleStrings): string {
  if (id === '__other') return localeStrings?.other ?? 'Other';
  if (id === '__none') return localeStrings?.noExtension ?? 'No extension';
  return id;
}

function extractPath(tab: VerticalTabItem): string | undefined {
  return tab.resourcePath ?? tab.description ?? (tab.label.includes('/') ? tab.label : undefined);
}

function readMtime(tab: VerticalTabItem): number | undefined {
  return tab.mtime;
}

function invertString(value: string): string {
  return Array.from(value).map((character) => String.fromCharCode(0xffff - character.charCodeAt(0))).join('');
}
