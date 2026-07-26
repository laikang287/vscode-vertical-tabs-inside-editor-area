import assert from 'node:assert/strict';
import test from 'node:test';
import { tabDragCapability } from '../../src/webview/dragPolicy';

test('manual sorting permits reordering in manual and VS Code grouping', () => {
  assert.equal(tabDragCapability('manual', 'none'), 'reorder');
  assert.equal(tabDragCapability('vscode', 'none'), 'reorder');
});

test('automatic sorting permits group changes but not reordering', () => {
  for (const sortMode of ['mru', 'modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc'] as const) {
    assert.equal(tabDragCapability('manual', sortMode), 'moveGroup');
    assert.equal(tabDragCapability('vscode', sortMode), 'moveGroup');
  }
});

test('parent-directory grouping moves files between directories and preserves manual ordering', () => {
  assert.equal(tabDragCapability('parentDir', 'none'), 'moveDirectoryAndReorder');
  for (const sortMode of ['mru', 'modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc'] as const) {
    assert.equal(tabDragCapability('parentDir', sortMode), 'moveDirectory');
  }
});

test('file-type grouping permits only manual ordering', () => {
  assert.equal(tabDragCapability('fileType', 'none'), 'reorder');
  for (const sortMode of ['mru', 'modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc'] as const) {
    assert.equal(tabDragCapability('fileType', sortMode), 'disabled');
  }
});
