import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VerticalTabDisplayGroup, VerticalTabItem } from '../../src/webview/messages';
import {
  NO_EXTENSION_FILE_TYPE,
  availableFileTypes,
  evaluateTabSearch,
  fileTypeForTab,
  findTextMatchRanges,
  tabPathMatches,
  type TabSearchFilters,
} from '../../src/webview/searchFilter';

const noFilters: TabSearchFilters = {
  unsavedOnly: false,
  pinnedOnly: false,
  currentGroupOnly: false,
};

test('searches labels and paths while combining all tab filters', () => {
  const dirtyPinnedTs = tab('alpha.ts', 0, { isDirty: true, isPinned: true, resourcePath: '/src/alpha.ts' });
  const cleanPinnedTs = tab('beta.ts', 0, { isPinned: true, resourcePath: '/src/beta.ts' });
  const dirtyPinnedJson = tab('alpha.json', 1, { isDirty: true, isPinned: true, resourcePath: '/config/alpha.json' });
  const groups = [
    group('source', 'Source', dirtyPinnedTs, cleanPinnedTs),
    group('config', 'Config', dirtyPinnedJson),
  ];

  const result = evaluateTabSearch(groups, {
    query: 'src',
    searchGroups: false,
    useRegex: false,
    currentGroupIndex: 0,
    filters: { unsavedOnly: true, pinnedOnly: true, currentGroupOnly: true, fileType: '.ts' },
  });

  assert.equal(result.matchedTabCount, 1);
  assert.deepEqual(result.groups.map(({ group: item }) => item.tabs.map((candidate) => candidate.label)), [['alpha.ts']]);
  assert.equal(result.groups[0]?.autoExpand, true);
});

test('group-name search counts matching groups and applies filters to their tabs', () => {
  const groups = [
    group('source', 'Source Files', tab('alpha.ts', 0, { isDirty: true }), tab('beta.ts', 0)),
    group('tests', 'Tests', tab('alpha.test.ts', 1, { isDirty: true })),
  ];
  const result = evaluateTabSearch(groups, {
    query: 'source',
    searchGroups: true,
    useRegex: false,
    filters: { ...noFilters, unsavedOnly: true },
  });

  assert.equal(result.matchedGroupCount, 1);
  assert.equal(result.matchedTabCount, 1);
  assert.deepEqual(result.groups.map(({ group: item }) => item.id), ['source']);
  assert.deepEqual(result.groups[0]?.group.tabs.map((candidate) => candidate.label), ['alpha.ts']);
});

test('invalid regular expressions report an error without filtering the tab list', () => {
  const groups = [group('source', 'Source', tab('alpha.ts', 0), tab('beta.ts', 0))];
  const result = evaluateTabSearch(groups, {
    query: '[',
    searchGroups: true,
    useRegex: true,
    filters: noFilters,
  });

  assert.ok(result.regexError);
  assert.equal(result.queryActive, false);
  assert.equal(result.affectsList, false);
  assert.equal(result.matchedTabCount, 2);
  assert.equal(result.groups[0]?.autoExpand, false);
  assert.deepEqual(result.groups[0]?.group.tabs.map((candidate) => candidate.label), ['alpha.ts', 'beta.ts']);
});

test('finds every literal and regular-expression highlight range', () => {
  assert.deepEqual(findTextMatchRanges('Alpha alpha', 'alpha', false), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
  ]);
  assert.deepEqual(findTextMatchRanges('src/app.test.ts', '(app|test)', true), [
    { start: 4, end: 7 },
    { start: 8, end: 12 },
  ]);
  assert.deepEqual(findTextMatchRanges('anything', '[', true), []);
});

test('derives available file extensions and detects path-only matches', () => {
  const typescript = tab('index.ts', 0, { resourcePath: '/workspace/src/index.ts' });
  const extensionless = tab('LICENSE', 0, { resourcePath: '/workspace/LICENSE' });
  const nonFile = tab('Settings', 0, { isFile: false, inputKind: 'webview' });

  assert.equal(fileTypeForTab(typescript), '.ts');
  assert.equal(fileTypeForTab(extensionless), NO_EXTENSION_FILE_TYPE);
  assert.equal(fileTypeForTab(nonFile), undefined);
  assert.deepEqual(availableFileTypes([extensionless, nonFile, typescript]), ['.ts', NO_EXTENSION_FILE_TYPE]);
  assert.equal(tabPathMatches(typescript, 'workspace/src', false), true);
  assert.equal(tabPathMatches(typescript, '^/workspace/.+\\.ts$', true), true);
});

function group(id: string, title: string, ...tabs: VerticalTabItem[]): VerticalTabDisplayGroup {
  return {
    id,
    title,
    collapsed: true,
    mode: 'manual',
    tabs,
    showHeader: true,
    isManual: true,
    isPinned: false,
  };
}

function tab(
  label: string,
  groupIndex: number,
  overrides: Partial<VerticalTabItem> = {},
): VerticalTabItem {
  return {
    target: { revision: 1, groupIndex, tabIndex: 0, identity: { kind: 'text', uri: `file:///${label}` } },
    label,
    isActive: false,
    isFocused: false,
    isDirty: false,
    isPinned: false,
    isPreview: false,
    isActivatable: true,
    activationKind: 'reliable',
    isFile: true,
    inputKind: 'text',
    icon: { kind: 'codicon', name: 'file' },
    ...overrides,
  };
}
