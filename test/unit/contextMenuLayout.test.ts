import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseContextSubmenuLayout, clampContextMenuCoordinate } from '../../src/webview/contextMenuLayout';

test('context submenu opens right when there is enough space', () => {
  assert.equal(chooseContextSubmenuLayout({ left: 20, right: 120 }, 100, 300, true), 'right');
});

test('context submenu opens left when only the left side fits', () => {
  assert.equal(chooseContextSubmenuLayout({ left: 150, right: 250 }, 120, 300, true), 'left');
});

test('context submenu drills into the parent menu when neither side fits', () => {
  assert.equal(chooseContextSubmenuLayout({ left: 60, right: 160 }, 120, 220, true), 'compact');
});

test('disabled compact mode preserves a flyout on the roomier side', () => {
  assert.equal(chooseContextSubmenuLayout({ left: 80, right: 180 }, 120, 240, false), 'left');
  assert.equal(chooseContextSubmenuLayout({ left: 40, right: 140 }, 120, 240, false), 'right');
});

test('submenu layout accepts an exact fit at the viewport margin', () => {
  assert.equal(chooseContextSubmenuLayout({ left: 100, right: 200 }, 96, 300, true), 'right');
  assert.equal(chooseContextSubmenuLayout({ left: 100, right: 200 }, 96, 300, true, 4), 'right');
});

test('context menu coordinates stay inside the viewport margins', () => {
  assert.equal(clampContextMenuCoordinate(120, 100, 300), 120);
  assert.equal(clampContextMenuCoordinate(280, 100, 300), 196);
  assert.equal(clampContextMenuCoordinate(-20, 100, 300), 4);
});
