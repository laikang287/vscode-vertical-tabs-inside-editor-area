import assert from 'node:assert/strict';
import test from 'node:test';
import { isKeyboardContextMenuKey, nextVerticalNavigationIndex } from '../../src/webview/keyboardNavigation';

test('tree navigation moves vertically without wrapping and supports boundaries', () => {
  assert.equal(nextVerticalNavigationIndex(1, 4, 'ArrowUp'), 0);
  assert.equal(nextVerticalNavigationIndex(1, 4, 'ArrowDown'), 2);
  assert.equal(nextVerticalNavigationIndex(0, 4, 'ArrowUp'), 0);
  assert.equal(nextVerticalNavigationIndex(3, 4, 'ArrowDown'), 3);
  assert.equal(nextVerticalNavigationIndex(2, 4, 'Home'), 0);
  assert.equal(nextVerticalNavigationIndex(1, 4, 'End'), 3);
  assert.equal(nextVerticalNavigationIndex(0, 0, 'ArrowDown'), -1);
});

test('menu navigation wraps between its first and last enabled actions', () => {
  assert.equal(nextVerticalNavigationIndex(0, 4, 'ArrowUp', true), 3);
  assert.equal(nextVerticalNavigationIndex(3, 4, 'ArrowDown', true), 0);
});

test('keyboard context menus accept the Menu key and Shift+F10 only', () => {
  assert.equal(isKeyboardContextMenuKey('ContextMenu', false), true);
  assert.equal(isKeyboardContextMenuKey('F10', true), true);
  assert.equal(isKeyboardContextMenuKey('F10', false), false);
  assert.equal(isKeyboardContextMenuKey('Enter', true), false);
});
