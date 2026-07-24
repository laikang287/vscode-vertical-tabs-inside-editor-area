import type { VerticalTabDisplayGroup, VerticalTabItem } from './messages';

export interface TabSearchCriteria {
  readonly query: string;
  readonly searchGroups: boolean;
  readonly searchWorkspaceRelativePaths: boolean;
  readonly useRegex: boolean;
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
  const active = compiled.active;
  const queryCanFilter = compiled.active && !compiled.error;
  const affectsList = queryCanFilter;
  const resultGroups: SearchDisplayGroup[] = [];
  let matchedTabCount = 0;
  let matchedGroupCount = 0;

  for (const group of groups) {
    const groupMatches = queryCanFilter && criteria.searchGroups && compiled.test(group.title);
    if (groupMatches) matchedGroupCount += 1;

    const visibleTabs = queryCanFilter && !groupMatches
      ? group.tabs.filter((tab) => tabMatchesQuery(tab, compiled, criteria.searchWorkspaceRelativePaths))
      : group.tabs;
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

export function tabWorkspaceRelativePathMatches(tab: VerticalTabItem, query: string, useRegex: boolean): boolean {
  const compiled = compileQuery(query, useRegex);
  return !compiled.error && compiled.test(tab.workspaceRelativePath);
}

function tabMatchesQuery(
  tab: VerticalTabItem,
  compiled: CompiledQuery,
  searchWorkspaceRelativePaths: boolean,
): boolean {
  return compiled.test(tab.label)
    || (searchWorkspaceRelativePaths && compiled.test(tab.workspaceRelativePath));
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
