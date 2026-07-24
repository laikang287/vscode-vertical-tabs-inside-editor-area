import assert from 'node:assert/strict';
import test from 'node:test';
import { adjacentCyclicIndex, moveItemsOneStep } from '../../src/tabs/TabCommands';

test('adjacent cyclic navigation wraps in both directions', () => {
  assert.equal(adjacentCyclicIndex(4, 0, -1), 3);
  assert.equal(adjacentCyclicIndex(4, 3, 1), 0);
  assert.equal(adjacentCyclicIndex(4, -1, -1), 3);
  assert.equal(adjacentCyclicIndex(4, -1, 1), 0);
  assert.equal(adjacentCyclicIndex(0, -1, 1), -1);
});

test('moves non-contiguous selections one position without changing their relative order', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'];

  assert.deepEqual(moveItemsOneStep(order, ['b', 'd', 'e'], -1), ['b', 'a', 'd', 'e', 'c', 'f']);
  assert.deepEqual(moveItemsOneStep(order, ['b', 'c', 'e'], 1), ['a', 'd', 'b', 'c', 'f', 'e']);
});

test('does not move a selected block beyond a group boundary', () => {
  const order = ['a', 'b', 'c', 'd'];

  assert.deepEqual(moveItemsOneStep(order, ['a', 'b'], -1), order);
  assert.deepEqual(moveItemsOneStep(order, ['c', 'd'], 1), order);
});
