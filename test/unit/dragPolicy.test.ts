import assert from 'node:assert/strict';
import test from 'node:test';
import { tabDragCapability } from '../../src/webview/dragPolicy';

test('manual sorting permits reordering in manual and VS Code grouping', () => {
  assert.equal(tabDragCapability('manual', 'none'), 'reorder');
  assert.equal(tabDragCapability('vscode', 'none'), 'reorder');
});

test('automatic sorting permits group changes but not reordering', () => {
  for (const sortMode of ['modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc'] as const) {
    assert.equal(tabDragCapability('manual', sortMode), 'moveGroup');
    assert.equal(tabDragCapability('vscode', sortMode), 'moveGroup');
  }
});

test('directory and file type grouping disable dragging', () => {
  for (const sortMode of ['none', 'modifiedAsc', 'modifiedDesc', 'nameAsc', 'nameDesc'] as const) {
    assert.equal(tabDragCapability('parentDir', sortMode), 'disabled');
    assert.equal(tabDragCapability('fileType', sortMode), 'disabled');
  }
});
