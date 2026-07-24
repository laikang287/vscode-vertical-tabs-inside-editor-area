import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VerticalTabDisplayGroup, VerticalTabItem } from '../../src/webview/messages';
import {
  evaluateTabSearch,
  findTextMatchRanges,
  tabWorkspaceRelativePathMatches,
} from '../../src/webview/searchFilter';

test('searches tab labels without matching paths by default', () => {
  const groups = [
    group(
      'source',
      'Source',
      tab('alpha.ts', 0, { workspaceRelativePath: 'src/alpha.ts' }),
      tab('beta.ts', 0, { workspaceRelativePath: 'test/beta.ts' }),
    ),
  ];

  const labelResult = evaluateTabSearch(groups, {
    query: 'alpha',
    searchGroups: false,
    searchWorkspaceRelativePaths: false,
    useRegex: false,
  });
  const disabledPathResult = evaluateTabSearch(groups, {
    query: 'src/',
    searchGroups: false,
    searchWorkspaceRelativePaths: false,
    useRegex: false,
  });

  assert.deepEqual(labelResult.groups[0]?.group.tabs.map((candidate) => candidate.label), ['alpha.ts']);
  assert.equal(disabledPathResult.matchedTabCount, 0);
  assert.deepEqual(disabledPathResult.groups, []);
});

test('searches workspace-relative paths only when enabled', () => {
  const workspaceFile = tab('index.ts', 0, {
    resourcePath: 'src/index.ts',
    workspaceRelativePath: 'packages/app/src/index.ts',
    tooltipPath: '/workspace/packages/app/src/index.ts',
  });
  const outsideFile = tab('outside.ts', 0, {
    resourcePath: '/tmp/outside.ts',
    tooltipPath: '/tmp/outside.ts',
  });
  const groups = [group('source', 'Source', workspaceFile, outsideFile)];

  const result = evaluateTabSearch(groups, {
    query: '^packages/app/',
    searchGroups: false,
    searchWorkspaceRelativePaths: true,
    useRegex: true,
  });

  assert.equal(result.matchedTabCount, 1);
  assert.deepEqual(result.groups[0]?.group.tabs.map((candidate) => candidate.label), ['index.ts']);
  assert.equal(tabWorkspaceRelativePathMatches(workspaceFile, 'app/src', false), true);
  assert.equal(tabWorkspaceRelativePathMatches(outsideFile, '/tmp', false), false);
});

test('group-name search counts matching groups and includes their tabs', () => {
  const groups = [
    group('source', 'Source Files', tab('alpha.ts', 0), tab('beta.ts', 0)),
    group('tests', 'Tests', tab('alpha.test.ts', 1)),
  ];
  const result = evaluateTabSearch(groups, {
    query: 'source',
    searchGroups: true,
    searchWorkspaceRelativePaths: false,
    useRegex: false,
  });

  assert.equal(result.matchedGroupCount, 1);
  assert.equal(result.matchedTabCount, 2);
  assert.deepEqual(result.groups.map(({ group: item }) => item.id), ['source']);
  assert.deepEqual(result.groups[0]?.group.tabs.map((candidate) => candidate.label), ['alpha.ts', 'beta.ts']);
});

test('invalid regular expressions report an error without filtering the tab list', () => {
  const groups = [group('source', 'Source', tab('alpha.ts', 0), tab('beta.ts', 0))];
  const result = evaluateTabSearch(groups, {
    query: '[',
    searchGroups: true,
    searchWorkspaceRelativePaths: true,
    useRegex: true,
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
    ...overrides,
  };
}
