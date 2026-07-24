import type { VerticalTabDisplayGroup, VerticalTabItem } from './messages';

export const NO_EXTENSION_FILE_TYPE = '__no_extension__';

export interface TabSearchFilters {
  readonly unsavedOnly: boolean;
  readonly pinnedOnly: boolean;
  readonly currentGroupOnly: boolean;
  readonly fileType?: string;
}

export interface TabSearchCriteria {
  readonly query: string;
  readonly searchGroups: boolean;
  readonly useRegex: boolean;
  readonly filters: TabSearchFilters;
  readonly currentGroupIndex?: number;
}

export interface TextMatchRange {
  readonly start: number;
  readonly end: number;
}

export interface SearchDisplayGroup {
  readonly group: VerticalTabDisplayGroup;
  readonly groupMatches: boolean;
  readonly autoExpand: boolean;
}

export interface TabSearchResult {
  readonly groups: readonly SearchDisplayGroup[];
  readonly matchedTabCount: number;
  readonly matchedGroupCount: number;
  readonly active: boolean;
  readonly affectsList: boolean;
  readonly queryActive: boolean;
  readonly regexError?: string;
}

interface CompiledQuery {
  readonly active: boolean;
  readonly error?: string;
  test(value: string | undefined): boolean;
  ranges(value: string): readonly TextMatchRange[];
}

export function evaluateTabSearch(
  groups: readonly VerticalTabDisplayGroup[],
  criteria: TabSearchCriteria,
): TabSearchResult {
  const compiled = compileQuery(criteria.query, criteria.useRegex);
  const filtersActive = hasActiveFilters(criteria.filters);
  const active = compiled.active || filtersActive;
  const queryCanFilter = compiled.active && !compiled.error;
  const affectsList = queryCanFilter || filtersActive;
  const resultGroups: SearchDisplayGroup[] = [];
  let matchedTabCount = 0;
  let matchedGroupCount = 0;

  for (const group of groups) {
    const eligibleTabs = group.tabs.filter((tab) => matchesFilters(tab, criteria.filters, criteria.currentGroupIndex));
    const groupMatches = queryCanFilter && criteria.searchGroups && compiled.test(group.title);
    if (groupMatches) matchedGroupCount += 1;

    const visibleTabs = queryCanFilter && !groupMatches
      ? eligibleTabs.filter((tab) => tabMatchesQuery(tab, compiled))
      : eligibleTabs;
    const includeGroup = !affectsList || visibleTabs.length > 0 || groupMatches;
    if (!includeGroup) continue;

    matchedTabCount += visibleTabs.length;
    resultGroups.push({
      group: visibleTabs === group.tabs ? group : { ...group, tabs: visibleTabs },
      groupMatches,
      autoExpand: affectsList && visibleTabs.length > 0,
    });
  }

  return {
    groups: resultGroups,
    matchedTabCount,
    matchedGroupCount,
    active,
    affectsList,
    queryActive: queryCanFilter,
    ...(compiled.error ? { regexError: compiled.error } : {}),
  };
}

export function findTextMatchRanges(value: string, query: string, useRegex: boolean): readonly TextMatchRange[] {
  return compileQuery(query, useRegex).ranges(value);
}

export function tabPathMatches(tab: VerticalTabItem, query: string, useRegex: boolean): boolean {
  const compiled = compileQuery(query, useRegex);
  return !compiled.error && tabPathCandidates(tab).some((candidate) => compiled.test(candidate));
}

export function availableFileTypes(tabs: readonly VerticalTabItem[]): readonly string[] {
  return Array.from(new Set(tabs.map(fileTypeForTab).filter((value): value is string => value !== undefined)))
    .sort((left, right) => {
      if (left === NO_EXTENSION_FILE_TYPE) return 1;
      if (right === NO_EXTENSION_FILE_TYPE) return -1;
      return left.localeCompare(right);
    });
}

export function fileTypeForTab(tab: VerticalTabItem): string | undefined {
  if (!tab.isFile) return undefined;
  const path = tab.resourcePath ?? tab.tooltipPath ?? tab.label;
  const basename = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const lastDot = basename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === basename.length - 1) return NO_EXTENSION_FILE_TYPE;
  return basename.slice(lastDot).toLowerCase();
}

function hasActiveFilters(filters: TabSearchFilters): boolean {
  return filters.unsavedOnly
    || filters.pinnedOnly
    || filters.currentGroupOnly
    || filters.fileType !== undefined;
}

function matchesFilters(tab: VerticalTabItem, filters: TabSearchFilters, currentGroupIndex: number | undefined): boolean {
  if (filters.unsavedOnly && !tab.isDirty) return false;
  if (filters.pinnedOnly && !tab.isPinned) return false;
  if (filters.currentGroupOnly && tab.target.groupIndex !== currentGroupIndex) return false;
  if (filters.fileType !== undefined && fileTypeForTab(tab) !== filters.fileType) return false;
  return true;
}

function tabMatchesQuery(tab: VerticalTabItem, compiled: CompiledQuery): boolean {
  return compiled.test(tab.label) || tabPathCandidates(tab).some((candidate) => compiled.test(candidate));
}

function tabPathCandidates(tab: VerticalTabItem): readonly string[] {
  return Array.from(new Set(
    [tab.description, tab.resourcePath, tab.tooltipPath].filter((value): value is string => Boolean(value)),
  ));
}

function compileQuery(query: string, useRegex: boolean): CompiledQuery {
  if (!query) {
    return {
      active: false,
      test: () => true,
      ranges: () => [],
    };
  }

  if (!useRegex) {
    const lowerQuery = query.toLocaleLowerCase();
    return {
      active: true,
      test: (value) => value?.toLocaleLowerCase().includes(lowerQuery) ?? false,
      ranges: (value) => literalMatchRanges(value, lowerQuery),
    };
  }

  try {
    const testExpression = new RegExp(query, 'iu');
    return {
      active: true,
      test: (value) => value !== undefined && testExpression.test(value),
      ranges: (value) => regexMatchRanges(value, query),
    };
  } catch (error) {
    return {
      active: true,
      error: error instanceof Error ? error.message : String(error),
      test: () => true,
      ranges: () => [],
    };
  }
}

function literalMatchRanges(value: string, lowerQuery: string): readonly TextMatchRange[] {
  const lowerValue = value.toLocaleLowerCase();
  const ranges: TextMatchRange[] = [];
  let offset = 0;
  while (offset <= lowerValue.length - lowerQuery.length) {
    const start = lowerValue.indexOf(lowerQuery, offset);
    if (start < 0) break;
    ranges.push({ start, end: start + lowerQuery.length });
    offset = start + Math.max(lowerQuery.length, 1);
  }
  return ranges;
}

function regexMatchRanges(value: string, query: string): readonly TextMatchRange[] {
  const expression = new RegExp(query, 'giu');
  const ranges: TextMatchRange[] = [];
  for (const match of value.matchAll(expression)) {
    const start = match.index;
    const text = match[0];
    if (start !== undefined && text.length > 0) {
      ranges.push({ start, end: start + text.length });
    }
  }
  return ranges;
}
