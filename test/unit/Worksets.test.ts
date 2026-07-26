import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStoredWorksets,
  selectReplacementCandidates,
  sortWorksets,
  worksetInputKey,
  worksetNamesEqual,
  type StoredWorksetV1,
} from '../../src/worksets/Worksets';

function storedWorkset(overrides: Partial<StoredWorksetV1> = {}): StoredWorksetV1 {
  return {
    schemaVersion: 1,
    id: 'workset-1',
    name: 'Feature A',
    createdAt: 10,
    updatedAt: 20,
    groupCount: 2,
    groupMode: 'manual',
    sortMode: 'none',
    tabs: [{
      id: 'tab-1',
      label: 'index.ts',
      input: { kind: 'text', uri: 'file:///workspace/index.ts' },
      groupIndex: 0,
      tabIndex: 0,
      isPinned: true,
      wasDirty: false,
      manualGroupId: 'group-1',
      workspaceFolderUri: 'file:///workspace',
      workspaceFolderName: 'workspace',
    }],
    manualGroups: [{ id: 'group-1', name: 'Source', collapsed: true }],
    manualOrderByGroup: [['group-1', ['tab-1']]],
    pinnedGroupIds: ['group-1'],
    collapsedGroupKeys: ['manual:group-1:closed'],
    activeTabId: 'tab-1',
    ...overrides,
  };
}

test('validates versioned worksets and rejects malformed nested tab data', () => {
  const valid = storedWorkset();
  assert.deepEqual(parseStoredWorksets([valid]), [valid]);
  assert.deepEqual(parseStoredWorksets([{ ...valid, schemaVersion: 2 }]), []);
  assert.deepEqual(parseStoredWorksets([{ ...valid, tabs: [{ ...valid.tabs[0], groupIndex: -1 }] }]), []);
  assert.deepEqual(parseStoredWorksets([{ ...valid, collapsedGroupKeys: ['bad\u0000key'] }]), []);
});

test('selects replacement tabs as a multiset while protecting dirty and pinned extras', () => {
  const selection = selectReplacementCandidates([
    { key: 'a', isDirty: false, isPinned: false },
    { key: 'a', isDirty: true, isPinned: false },
    { key: 'b', isDirty: false, isPinned: true },
    { key: 'c', isDirty: false, isPinned: false },
  ], ['a']);
  assert.deepEqual(selection.matchedIndexes, [0]);
  assert.deepEqual(selection.protectedIndexes, [1, 2]);
  assert.deepEqual(selection.closeIndexes, [3]);
});

test('keeps restore identities type-specific and names case-insensitively unique', () => {
  assert.notEqual(
    worksetInputKey({ kind: 'custom', uri: 'file:///a', viewType: 'one' }),
    worksetInputKey({ kind: 'custom', uri: 'file:///a', viewType: 'two' }),
  );
  assert.notEqual(
    worksetInputKey({ kind: 'notebook', uri: 'file:///a', notebookType: 'jupyter' }),
    worksetInputKey({ kind: 'text', uri: 'file:///a' }),
  );
  assert.equal(worksetNamesEqual(' Feature A ', 'feature a'), true);
  assert.equal(worksetNamesEqual('Feature A', 'Feature B'), false);
});

test('sorts worksets by most recent update and then by name', () => {
  const older = storedWorkset({ id: 'older', name: 'Zeta', updatedAt: 10 });
  const alpha = storedWorkset({ id: 'alpha', name: 'Alpha', updatedAt: 30 });
  const beta = storedWorkset({ id: 'beta', name: 'Beta', updatedAt: 30 });
  assert.deepEqual(sortWorksets([older, beta, alpha]).map((item) => item.id), ['alpha', 'beta', 'older']);
});
