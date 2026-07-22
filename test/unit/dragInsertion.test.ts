import assert from 'node:assert/strict';
import test from 'node:test';
import { dragInsertionEdge } from '../../src/webview/dragInsertion';

test('drag insertion uses the upper and lower halves of a tab as before and after targets', () => {
  assert.equal(dragInsertionEdge(109, 100, 20), 'before');
  assert.equal(dragInsertionEdge(110, 100, 20), 'after');
  assert.equal(dragInsertionEdge(119, 100, 20), 'after');
});

test('drag insertion handles invalid or negative row heights without producing an invalid edge', () => {
  assert.equal(dragInsertionEdge(99, 100, Number.NaN), 'before');
  assert.equal(dragInsertionEdge(100, 100, -20), 'after');
});
