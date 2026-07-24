import assert from 'node:assert/strict';
import test from 'node:test';
import { ShortcutReleaseTracker, type ShortcutReleaseKeyState } from '../../src/webview/ShortcutReleaseTracker';

test('waits for Ctrl after Tab is released', () => {
  const tracker = new ShortcutReleaseTracker();
  tracker.arm('shortcut-release-1', 'Tab');

  assert.deepEqual(tracker.keyUp(keyState('Tab', { ctrlKey: true })), { type: 'none' });
  assert.deepEqual(tracker.keyUp(keyState('Control')), {
    type: 'complete',
    sessionId: 'shortcut-release-1',
  });
  assert.equal(tracker.activeSessionId, undefined);
});

test('waits for Tab after Ctrl is released', () => {
  const tracker = new ShortcutReleaseTracker();
  tracker.arm('shortcut-release-2', 'Tab');

  assert.deepEqual(tracker.keyUp(keyState('Control')), { type: 'none' });
  assert.deepEqual(tracker.keyUp(keyState('Tab')), {
    type: 'complete',
    sessionId: 'shortcut-release-2',
  });
});

test('rearming the same session waits for the final repeated Tab release', () => {
  const tracker = new ShortcutReleaseTracker();
  tracker.arm('shortcut-release-3', 'Tab');
  tracker.keyUp(keyState('Tab', { ctrlKey: true }));

  tracker.arm('shortcut-release-3', 'Tab');
  assert.deepEqual(tracker.keyUp(keyState('Control')), { type: 'none' });
  assert.deepEqual(tracker.keyUp(keyState('Tab')), {
    type: 'complete',
    sessionId: 'shortcut-release-3',
  });
});

test('waits for every modifier used by Ctrl+Shift+Tab', () => {
  const tracker = new ShortcutReleaseTracker();
  tracker.arm('shortcut-release-4', 'Tab');

  assert.deepEqual(tracker.keyUp(keyState('Tab', { ctrlKey: true, shiftKey: true })), { type: 'none' });
  assert.deepEqual(tracker.keyUp(keyState('Shift', { ctrlKey: true })), { type: 'none' });
  assert.deepEqual(tracker.keyUp(keyState('Control')), {
    type: 'complete',
    sessionId: 'shortcut-release-4',
  });
});

test('ignores unrelated key releases and completes at most once', () => {
  const tracker = new ShortcutReleaseTracker();
  tracker.arm('shortcut-release-5', 'Tab');

  assert.deepEqual(tracker.keyUp(keyState('ArrowDown')), { type: 'none' });
  assert.deepEqual(tracker.keyUp(keyState('Tab')), {
    type: 'complete',
    sessionId: 'shortcut-release-5',
  });
  assert.deepEqual(tracker.keyUp(keyState('Control')), { type: 'none' });
});

test('cancellation only clears the matching active session', () => {
  const tracker = new ShortcutReleaseTracker();
  tracker.arm('shortcut-release-6', 'Tab');

  assert.equal(tracker.cancel('shortcut-release-7'), undefined);
  assert.equal(tracker.activeSessionId, 'shortcut-release-6');
  assert.equal(tracker.cancel('shortcut-release-6'), 'shortcut-release-6');
  assert.equal(tracker.activeSessionId, undefined);
  assert.deepEqual(tracker.keyUp(keyState('Tab')), { type: 'none' });
});

function keyState(
  key: string,
  modifiers: Partial<Omit<ShortcutReleaseKeyState, 'key'>> = {},
): ShortcutReleaseKeyState {
  return {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  };
}
