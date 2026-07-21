import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countLayoutLeaves,
  isEditorLayout,
  MAX_PERSISTED_RAIL_RATIO,
  MIN_RAIL_WIDTH,
  normalizeRailWidth,
  prependRailToLayout,
  resolveRailRatio,
  setLeadingRailWidth,
  shouldPersistObservedRailWidth,
  shouldPersistRailGroupRatio,
} from '../../src/layout/RailLayout';

test('prepends a full-height rail to a horizontal editor layout', () => {
  const layout = { orientation: 0, groups: [{ size: 500 }, { groups: [{ size: 240 }, { size: 260 }] }] } as const;
  const result = prependRailToLayout(layout, 280);

  assert.equal(result.orientation, 0);
  assert.equal(result.groups[0].size, 280);
  assert.equal(result.groups.length, 3);
  assert.equal(countLayoutLeaves(result), 4);
});

test('wraps a vertical editor layout so the rail stays full-height', () => {
  const layout = { orientation: 1, groups: [{ size: 400 }, { size: 400 }] } as const;
  const result = prependRailToLayout(layout, 320);

  assert.equal(result.orientation, 0);
  assert.equal(result.groups[0].size, 320);
  assert.deepEqual(result.groups[1], { groups: [{ size: 400 }, { size: 400 }] });
});

test('updates only the leading rail leaf and validates persisted widths', () => {
  const layout = { orientation: 0, groups: [{ groups: [{ size: 200 }, { size: 100 }] }, { size: 500 }] } as const;
  const result = setLeadingRailWidth(layout, 333.8);

  assert.equal(result.groups[0].groups?.[0].size, 334);
  assert.equal(result.groups[0].groups?.[1].size, 100);
  assert.equal(normalizeRailWidth(20), MIN_RAIL_WIDTH);
  assert.equal(normalizeRailWidth('invalid', 310), 310);
});

test('updates the left-most leaf in a nested editor layout', () => {
  const layout = { orientation: 0, groups: [{ groups: [{ groups: [{ size: 200 }, { size: 210 }] }, { size: 220 }] }, { size: 600 }] } as const;
  const result = setLeadingRailWidth(layout, 295);

  assert.equal(result.groups[0].groups?.[0].groups?.[0].size, 295);
  assert.equal(result.groups[0].groups?.[0].groups?.[1].size, 210);
  assert.equal(result.groups[0].groups?.[1].size, 220);
  assert.equal(result.groups[1].size, 600);
});

test('does not persist rail width when the rail is the only editor group or effectively full-width', () => {
  assert.equal(shouldPersistObservedRailWidth({ orientation: 0, groups: [{ size: 1000 }] }, 1000), false);
  assert.equal(shouldPersistRailGroupRatio({ orientation: 0, groups: [{ size: 1000 }] }), false);
  assert.equal(shouldPersistObservedRailWidth({ orientation: 0, groups: [{ size: 950 }, { size: 50 }] }, 950), false);
  assert.equal(shouldPersistRailGroupRatio({ orientation: 0, groups: [{ size: 950 }, { size: 50 }] }), false);
  assert.equal(shouldPersistObservedRailWidth({ orientation: 0, groups: [{ size: 500 }, { size: 500 }] }, 500), false);
  assert.equal(shouldPersistRailGroupRatio({ orientation: 0, groups: [{ size: 500 }, { size: 500 }] }), false);
  assert.equal(shouldPersistObservedRailWidth({ orientation: 0, groups: [{ size: 350 }, { size: 650 }] }, 350), false);
  assert.equal(shouldPersistRailGroupRatio({ orientation: 0, groups: [{ size: 350 }, { size: 650 }] }), false);
  assert.equal(shouldPersistObservedRailWidth({ orientation: 0, groups: [{ size: 240 }, { size: 80 }] }, 240), false);
  assert.equal(shouldPersistRailGroupRatio({ orientation: 0, groups: [{ size: 240 }, { size: 80 }] }), false);
  assert.equal(shouldPersistObservedRailWidth({ orientation: 0, groups: [{ size: 240 }, { size: 760 }] }, 240), true);
  assert.equal(shouldPersistRailGroupRatio({ orientation: 0, groups: [{ size: 240 }, { size: 760 }] }), true);
  assert.equal(MAX_PERSISTED_RAIL_RATIO, 0.3);
});

test('resolves saved rail ratio before falling back to the configured default', () => {
  assert.equal(resolveRailRatio(0.33, 0.2), 0.33);
  assert.equal(resolveRailRatio(undefined, 0.24), 0.24);
  assert.equal(resolveRailRatio(undefined, undefined), 0.2);
  assert.equal(resolveRailRatio(0.02, 0.2), 0.1);
  assert.equal(resolveRailRatio(0.99, 0.2), 0.5);
});

test('rejects invalid editor layout values', () => {
  assert.equal(isEditorLayout(undefined), false);
  assert.equal(isEditorLayout({}), false);
  assert.equal(isEditorLayout({ groups: 'invalid' }), false);
  assert.equal(isEditorLayout({ groups: [] }), true);
});
