import * as path from 'node:path';
import type {
  GroupMode,
  ManualTabGroup,
  SortMode,
  TabTargetIdentity,
  TabActivationKind,
  VerticalTabDisplayGroup,
  VerticalTabItem,
  VerticalTabsSnapshot,
} from '../webview/messages';

export type TabInputKind = 'text' | 'diff' | 'custom' | 'notebook' | 'notebookDiff' | 'webview' | 'terminal' | 'unknown';

export interface SnapshotSourceTab {
  readonly label: string;
  readonly isActive: boolean;
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
  readonly manualOrderByGroup?: ReadonlyMap<string, readonly string[]>;
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

  const displayGroups = buildDisplayGroups(groups, tabs, manualGroups, groupMode, sortMode, options.manualOrderByGroup);
  return { revision, groupMode, sortMode, tabs, manualGroups, displayGroups };
}

export function selectCloseTargets(snapshot: VerticalTabsSnapshot, action: CloseAction, target?: VerticalTabItem['target']): VerticalTabItem['target'][] {
  if (action === 'closeSaved') return snapshot.tabs.filter((tab) => !tab.isDirty && !tab.isPinned).map((tab) => tab.target);
  if (action === 'closeAll') return snapshot.tabs.filter((tab) => !tab.isPinned).map((tab) => tab.target);
  if (!target) return [];
  const selected = snapshot.tabs.find((tab) => sameTarget(tab.target, target));
  if (!selected) return [];
  if (action === 'close') return [target];
  const bucket = findDisplayBucket(snapshot, selected) ?? snapshot.tabs.filter((tab) => tab.manualGroupId === selected.manualGroupId);
  const index = bucket.findIndex((tab) => sameTarget(tab.target, target));
  const candidates = action === 'closeOthers' ? bucket.filter((tab) => !sameTarget(tab.target, target)) : bucket.slice(index + 1);
  return candidates.filter((tab) => !tab.isPinned).map((tab) => tab.target);
}

export function sameTarget(left: VerticalTabItem['target'], right: VerticalTabItem['target']): boolean {
  if (sameIdentity(left.identity, right.identity)) return true;
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

function buildDisplayGroups(
  sourceGroups: readonly SnapshotSourceGroup[],
  tabs: readonly VerticalTabItem[],
  manualGroups: readonly ManualTabGroup[],
  groupMode: GroupMode,
  sortMode: SortMode,
  manualOrderByGroup: ReadonlyMap<string, readonly string[]> | undefined,
): VerticalTabDisplayGroup[] {
  if (groupMode === 'manual') return buildManualGroups(tabs, manualGroups, sortMode, manualOrderByGroup);
  if (groupMode === 'parentDir') return buildAutoGroups(tabs, 'parentDir', sortMode);
  if (groupMode === 'fileType') return buildAutoGroups(tabs, 'fileType', sortMode);
  return buildVsCodeGroups(sourceGroups, tabs, sortMode);
}

function buildVsCodeGroups(sourceGroups: readonly SnapshotSourceGroup[], tabs: readonly VerticalTabItem[], sortMode: SortMode): VerticalTabDisplayGroup[] {
  const groups: VerticalTabDisplayGroup[] = [];
  for (let sourceIndex = 0; sourceIndex < sourceGroups.length; sourceIndex += 1) {
    const groupTabs = tabs.filter((tab) => tab.target.groupIndex === sourceIndex);
    if (groupTabs.length === 0) continue;
    groups.push({
      id: `vscode-${sourceIndex}`,
      title: sourceGroups[sourceIndex]?.label ?? `编辑器组 ${groups.length + 1}`,
      collapsed: false,
      mode: 'vscode',
      tabs: sortTabs(groupTabs, sortMode),
      showHeader: true,
      isManual: false,
    });
  }
  if (groups.length === 1) {
    groups[0] = { ...groups[0], showHeader: false };
  }
  return groups;
}

function buildManualGroups(
  tabs: readonly VerticalTabItem[],
  manualGroups: readonly ManualTabGroup[],
  sortMode: SortMode,
  manualOrderByGroup: ReadonlyMap<string, readonly string[]> | undefined,
): VerticalTabDisplayGroup[] {
  const knownGroups = new Set(manualGroups.map((group) => group.id));
  const ungrouped = orderManualTabs(tabs.filter((tab) => !tab.manualGroupId || !knownGroups.has(tab.manualGroupId)), '__ungrouped', manualOrderByGroup);
  const displayGroups: VerticalTabDisplayGroup[] = [];
  if (ungrouped.length > 0 || manualGroups.length === 0) {
    displayGroups.push({
      id: '__ungrouped',
      title: '未分组',
      collapsed: false,
      mode: 'manual',
      tabs: sortTabs(ungrouped, sortMode),
      showHeader: false,
      isManual: true,
    });
  }
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
    });
  }
  return displayGroups;
}

function buildAutoGroups(tabs: readonly VerticalTabItem[], groupMode: 'parentDir' | 'fileType', sortMode: SortMode): VerticalTabDisplayGroup[] {
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
      const title = parentDirTitle(id);
      parentNameCounts.set(title, (parentNameCounts.get(title) ?? 0) + 1);
    }
  }
  const parentDescriptions = groupMode === 'parentDir'
    ? shortestUniquePathSuffixes(Array.from(buckets.keys()).map((id) => ({ key: id, path: id })))
    : new Map<string, string>();
  return Array.from(buckets.entries()).map(([id, groupTabs]) => {
    const title = groupMode === 'parentDir' ? parentDirTitle(id) : fileTypeTitle(id);
    return {
      id,
      title,
      description: groupMode === 'parentDir' && parentNameCounts.get(title) !== 1 ? parentDescriptions.get(id) : undefined,
      collapsed: false,
      mode: groupMode,
      tabs: sortTabs(groupTabs, sortMode),
      showHeader: true,
      isManual: false,
    };
  });
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
  if (sortMode === 'none') return tabs;
  return tabs
    .map((tab, index) => ({ tab, index, fileSort: fileSortValue(tab, sortMode) }))
    .sort((left, right) => {
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
  return snapshot.displayGroups.find((group) => group.tabs.some((tab) => sameTarget(tab.target, selected.target)))?.tabs;
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

function parentDirTitle(id: string): string {
  if (id === '__other') return '其他';
  if (id === '__root') return '工作区根目录';
  return path.posix.basename(id);
}

function fileTypeKey(tab: VerticalTabItem): string {
  const tabPath = extractPath(tab);
  if (!tabPath || !tab.isFile) return '__other';
  const extension = path.posix.extname(tabPath || tab.label).toLowerCase();
  return extension || '__none';
}

function fileTypeTitle(id: string): string {
  if (id === '__other') return '其他';
  if (id === '__none') return '无扩展名';
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
