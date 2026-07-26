import type * as vscode from 'vscode';
import { normalizeManualGroups } from '../tabs/GroupTree';
import type { GroupMode, ManualTabGroup, SortMode } from '../webview/messages';

export const WORKSETS_STORAGE_KEY = 'verticalTabs.worksets.v1';
export const WORKSET_SCHEMA_VERSION = 2;
export const MAX_WORKSETS = 500;
export const MAX_WORKSET_TABS = 2000;
export const MAX_COLLAPSED_GROUP_KEYS = 2000;
export const MAX_WORKSET_NAME_LENGTH = 80;

export type WorksetTabInput =
  | { readonly kind: 'text'; readonly uri: string }
  | { readonly kind: 'diff'; readonly originalUri: string; readonly modifiedUri: string }
  | { readonly kind: 'custom'; readonly uri: string; readonly viewType: string }
  | { readonly kind: 'notebook'; readonly uri: string; readonly notebookType: string }
  | { readonly kind: 'notebookDiff'; readonly originalUri: string; readonly modifiedUri: string; readonly notebookType: string }
  | { readonly kind: 'webview'; readonly viewType: string; readonly label: string; readonly builtIn?: 'welcome' | 'settings' }
  | { readonly kind: 'terminal'; readonly label: string }
  | { readonly kind: 'unknown'; readonly label: string };

export interface StoredWorksetTab {
  readonly id: string;
  readonly label: string;
  readonly input: WorksetTabInput;
  readonly groupIndex: number;
  readonly tabIndex: number;
  readonly isPinned: boolean;
  readonly wasDirty: boolean;
  readonly manualGroupId?: string;
  readonly workspaceFolderUri?: string;
  readonly workspaceFolderName?: string;
}

export interface StoredWorksetV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly groupCount: number;
  readonly groupMode: GroupMode;
  readonly sortMode: SortMode;
  readonly tabs: readonly StoredWorksetTab[];
  readonly manualGroups: readonly ManualTabGroup[];
  readonly manualOrderByGroup: readonly (readonly [string, readonly string[]])[];
  readonly pinnedGroupIds: readonly string[];
  readonly collapsedGroupKeys: readonly string[];
  readonly activeTabId?: string;
}

export interface StoredWorksetV2 extends Omit<StoredWorksetV1, 'schemaVersion'> {
  readonly schemaVersion: 2;
}

export type StoredWorkset = StoredWorksetV2;

export type WorksetRestoreFailureCategory =
  | 'notFound'
  | 'moved'
  | 'deleted'
  | 'permission'
  | 'unsupported'
  | 'openFailed';

export interface WorksetRestoreFailure {
  readonly category: WorksetRestoreFailureCategory;
  readonly label: string;
  readonly detail: string;
}

export interface ReplacementCandidate {
  readonly key: string;
  readonly isDirty: boolean;
  readonly isPinned: boolean;
}

export interface ReplacementSelection {
  readonly matchedIndexes: readonly number[];
  readonly closeIndexes: readonly number[];
  readonly protectedIndexes: readonly number[];
}

export function selectReplacementCandidates(
  current: readonly ReplacementCandidate[],
  desiredKeys: readonly string[],
): ReplacementSelection {
  const remaining = new Map<string, number>();
  for (const key of desiredKeys) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  const matchedIndexes: number[] = [];
  const closeIndexes: number[] = [];
  const protectedIndexes: number[] = [];
  for (let index = 0; index < current.length; index += 1) {
    const candidate = current[index];
    const count = remaining.get(candidate.key) ?? 0;
    if (count > 0) {
      matchedIndexes.push(index);
      remaining.set(candidate.key, count - 1);
    } else if (candidate.isDirty || candidate.isPinned) {
      protectedIndexes.push(index);
    } else {
      closeIndexes.push(index);
    }
  }
  return { matchedIndexes, closeIndexes, protectedIndexes };
}

export function normalizeWorksetName(value: string): string {
  return value.trim();
}

export function worksetNamesEqual(left: string, right: string): boolean {
  return normalizeWorksetName(left).localeCompare(normalizeWorksetName(right), undefined, { sensitivity: 'accent' }) === 0;
}

export function worksetInputKey(input: WorksetTabInput): string {
  switch (input.kind) {
    case 'text':
      return `text:${input.uri}`;
    case 'diff':
      return `diff:${input.originalUri}\u0000${input.modifiedUri}`;
    case 'custom':
      return `custom:${input.viewType}\u0000${input.uri}`;
    case 'notebook':
      return `notebook:${input.notebookType}\u0000${input.uri}`;
    case 'notebookDiff':
      return `notebookDiff:${input.notebookType}\u0000${input.originalUri}\u0000${input.modifiedUri}`;
    case 'webview':
      return `webview:${input.viewType}\u0000${input.label}`;
    case 'terminal':
      return `terminal:${input.label}`;
    case 'unknown':
      return `unknown:${input.label}`;
  }
}

export function parseStoredWorksets(value: unknown): StoredWorkset[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_WORKSETS).flatMap((item) => {
    if (!isStoredWorkset(item)) return [];
    const manualGroups = item.schemaVersion === 1
      ? item.manualGroups.map((group) => ({ id: group.id, name: group.name, collapsed: group.collapsed }))
      : item.manualGroups;
    return [{
      ...item,
      schemaVersion: WORKSET_SCHEMA_VERSION,
      manualGroups: normalizeManualGroups(manualGroups),
    }];
  });
}

export function sortWorksets(worksets: readonly StoredWorkset[]): StoredWorkset[] {
  return [...worksets].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
}

export async function writeStoredWorksets(
  state: vscode.Memento,
  worksets: readonly StoredWorkset[],
): Promise<void> {
  await state.update(WORKSETS_STORAGE_KEY, worksets.slice(0, MAX_WORKSETS));
}

export function isCollapsedGroupKeys(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= MAX_COLLAPSED_GROUP_KEYS
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(item));
}

function isStoredWorkset(value: unknown): value is StoredWorksetV1 | StoredWorksetV2 {
  if (!isRecord(value)
    || (value.schemaVersion !== 1 && value.schemaVersion !== WORKSET_SCHEMA_VERSION)
    || !isId(value.id)
    || !isWorksetName(value.name)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
    || !isNonNegativeInteger(value.groupCount)
    || !isGroupMode(value.groupMode)
    || !isSortMode(value.sortMode)
    || !Array.isArray(value.tabs)
    || value.tabs.length > MAX_WORKSET_TABS
    || !value.tabs.every(isStoredWorksetTab)
    || !Array.isArray(value.manualGroups)
    || !value.manualGroups.every(isManualGroup)
    || !isStringArrayEntries(value.manualOrderByGroup)
    || !isStringArray(value.pinnedGroupIds)
    || !isCollapsedGroupKeys(value.collapsedGroupKeys)
    || (value.activeTabId !== undefined && !isId(value.activeTabId))) {
    return false;
  }
  return true;
}

function isStoredWorksetTab(value: unknown): value is StoredWorksetTab {
  return isRecord(value)
    && isId(value.id)
    && typeof value.label === 'string'
    && value.label.length > 0
    && value.label.length <= 500
    && isWorksetTabInput(value.input)
    && isNonNegativeInteger(value.groupIndex)
    && isNonNegativeInteger(value.tabIndex)
    && typeof value.isPinned === 'boolean'
    && typeof value.wasDirty === 'boolean'
    && (value.manualGroupId === undefined || isId(value.manualGroupId))
    && (value.workspaceFolderUri === undefined || isUri(value.workspaceFolderUri))
    && (value.workspaceFolderName === undefined || isShortString(value.workspaceFolderName, 500));
}

function isWorksetTabInput(value: unknown): value is WorksetTabInput {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'text') return isUri(value.uri);
  if (value.kind === 'diff') return isUri(value.originalUri) && isUri(value.modifiedUri);
  if (value.kind === 'custom') return isUri(value.uri) && isShortString(value.viewType, 200);
  if (value.kind === 'notebook') return isUri(value.uri) && isShortString(value.notebookType, 200);
  if (value.kind === 'notebookDiff') {
    return isUri(value.originalUri) && isUri(value.modifiedUri) && isShortString(value.notebookType, 200);
  }
  if (value.kind === 'webview') {
    return isShortString(value.viewType, 200)
      && isShortString(value.label, 500)
      && (value.builtIn === undefined || value.builtIn === 'welcome' || value.builtIn === 'settings');
  }
  return (value.kind === 'terminal' || value.kind === 'unknown') && isShortString(value.label, 500);
}

function isManualGroup(value: unknown): value is ManualTabGroup {
  return isRecord(value)
    && isId(value.id)
    && isShortString(value.name, MAX_WORKSET_NAME_LENGTH)
    && typeof value.collapsed === 'boolean'
    && (value.parentId === undefined || isId(value.parentId));
}

function isStringArrayEntries(value: unknown): value is readonly (readonly [string, readonly string[]])[] {
  return Array.isArray(value)
    && value.length <= MAX_WORKSET_TABS
    && value.every((entry) => Array.isArray(entry) && entry.length === 2 && isId(entry[0]) && isStringArray(entry[1]));
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_WORKSET_TABS && value.every((item) => typeof item === 'string' && item.length <= 4096);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function isWorksetName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_WORKSET_NAME_LENGTH;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isUri(value: unknown): value is string {
  return isShortString(value, 4096);
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isGroupMode(value: unknown): value is GroupMode {
  return value === 'vscode' || value === 'manual' || value === 'parentDir' || value === 'parentDirTree' || value === 'fileType';
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'none' || value === 'mru' || value === 'modifiedAsc' || value === 'modifiedDesc' || value === 'nameAsc' || value === 'nameDesc';
}
