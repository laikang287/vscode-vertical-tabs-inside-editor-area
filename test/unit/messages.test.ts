import assert from 'node:assert/strict';
import test from 'node:test';
import { SingletonPanel } from '../../src/webview/SingletonPanel';
import { parseWebviewMessage } from '../../src/webview/messages';

test('accepts ready messages', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
});

test('accepts refresh requests', () => {
  assert.deepEqual(parseWebviewMessage({ type: 'requestRefresh' }), { type: 'requestRefresh' });
});

test('rejects malformed and unknown messages', () => {
  for (const value of [undefined, null, [], 'ready', {}, { type: 'unknown' }, { type: 42 }]) {
    assert.equal(parseWebviewMessage(value), undefined);
  }
});

test('creates once, reveals the existing panel, and clears on disposal', () => {
  const panels = new SingletonPanel<{ readonly id: number }>();
  const created = { id: 1 };
  const revealed: number[] = [];

  assert.equal(panels.show(() => created, (panel) => revealed.push(panel.id)), created);
  assert.equal(panels.show(() => ({ id: 2 }), (panel) => revealed.push(panel.id)), created);
  assert.deepEqual(revealed, [1]);

  panels.clear(created);
  assert.equal(panels.current, undefined);
});
