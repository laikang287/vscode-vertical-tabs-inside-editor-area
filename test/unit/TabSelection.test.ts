import assert from 'node:assert/strict';
import test from 'node:test';
import { TabSelection, selectionKey } from '../../src/webview/TabSelection';
import type { VerticalTabItem } from '../../src/webview/messages';

test('uses Windows-style single, Shift range, and Ctrl/Cmd toggle selection', () => {
  const tabs = [tab('a', 0, 0), tab('b', 0, 1), tab('c', 0, 2), tab('d', 1, 0), tab('e', 1, 1)];
  const selection = new TabSelection();

  selection.selectSingle(tabs[1]);
  assert.deepEqual(selection.keys(), [selectionKey(tabs[1])]);

  selection.update(tabs, tabs[4], { shiftKey: true, toggleKey: false });
  assert.deepEqual(selection.keys(), tabs.slice(1).map(selectionKey));

  selection.update(tabs, tabs[2], { shiftKey: false, toggleKey: true });
  assert.deepEqual(selection.keys(), [selectionKey(tabs[1]), selectionKey(tabs[3]), selectionKey(tabs[4])]);

  selection.update(tabs, tabs[0], { shiftKey: false, toggleKey: true });
  assert.deepEqual(selection.keys(), [selectionKey(tabs[1]), selectionKey(tabs[3]), selectionKey(tabs[4]), selectionKey(tabs[0])]);
});

test('allows Ctrl/Cmd to clear the final selection and falls back to the operated tab', () => {
  const only = tab('only', 0, 0);
  const selection = new TabSelection();
  selection.selectSingle(only);

  selection.update([only], only, { shiftKey: false, toggleKey: true });

  assert.deepEqual(selection.keys(), []);
  assert.deepEqual(selection.selectedTabs([only], only), [only]);
});

test('keeps identical resources in different VS Code groups independently selectable', () => {
  const left = tab('same', 0, 0);
  const right = tab('same', 1, 0);
  const selection = new TabSelection();

  selection.selectSingle(left);
  selection.update([left, right], right, { shiftKey: false, toggleKey: true });

  assert.notEqual(selectionKey(left), selectionKey(right));
  assert.deepEqual(selection.selectedTabs([left, right], right), [left, right]);
});

test('preserves chronological selection order for comparison, including reverse Shift ranges', () => {
  const tabs = [tab('a', 0, 0), tab('b', 0, 1), tab('c', 0, 2)];
  const selection = new TabSelection();

  selection.selectSingle(tabs[2]);
  selection.update(tabs, tabs[0], { shiftKey: true, toggleKey: false });

  assert.deepEqual(selection.orderedTabs(tabs), [tabs[2], tabs[1], tabs[0]]);
  assert.deepEqual(selection.selectedTabs(tabs, tabs[0]), [tabs[2], tabs[1], tabs[0]]);
});

test('prunes closed tabs and a stale range anchor', () => {
  const first = tab('first', 0, 0);
  const second = tab('second', 0, 1);
  const selection = new TabSelection();
  selection.selectSingle(first);
  selection.update([first, second], second, { shiftKey: false, toggleKey: true });

  selection.prune([second]);
  selection.update([second], second, { shiftKey: true, toggleKey: false });

  assert.deepEqual(selection.keys(), [selectionKey(second)]);
});

function tab(label: string, groupIndex: number, tabIndex: number): VerticalTabItem {
  return {
    target: {
      revision: 1,
      groupIndex,
      tabIndex,
      identity: { kind: 'text', uri: `file:///${label}.ts` },
    },
    label,
    isActive: false,
    isFocused: false,
    isDirty: false,
    isPinned: false,
    isPreview: false,
    activationKind: 'reliable',
    isActivatable: true,
    isFile: true,
    inputKind: 'text',
  };
}
