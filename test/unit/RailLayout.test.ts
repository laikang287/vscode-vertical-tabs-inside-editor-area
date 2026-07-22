import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctMinimizedEditorGroupWidth,
  countLayoutLeaves,
  findLayoutLeafPath,
  getEditorGroupWidth,
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

test('maps view columns to layout leaves in grid appearance order', () => {
  const layout = {
    orientation: 0,
    groups: [
      { size: 400 },
      { size: 600, groups: [{ size: 300 }, { groups: [{ size: 150 }, { size: 150 }] }] },
    ],
  } as const;

  assert.deepEqual(findLayoutLeafPath(layout, 1), [0]);
  assert.deepEqual(findLayoutLeafPath(layout, 2), [1, 0]);
  assert.deepEqual(findLayoutLeafPath(layout, 3), [1, 1, 0]);
  assert.deepEqual(findLayoutLeafPath(layout, 4), [1, 1, 1]);
  assert.equal(findLayoutLeafPath(layout, 5), undefined);
  assert.equal(findLayoutLeafPath(layout, 0), undefined);
  assert.equal(getEditorGroupWidth(layout, 1), 400);
  assert.equal(getEditorGroupWidth(layout, 2), 600);
  assert.equal(getEditorGroupWidth(layout, 3), 150);
  assert.equal(getEditorGroupWidth(layout, 5), undefined);
});

test('corrects only the minimized editor group identified by view column', () => {
  const layout = { orientation: 0, groups: [{ size: 220 }, { size: 220 }, { size: 955 }] } as const;

  const firstGroup = correctMinimizedEditorGroupWidth(layout, 1);
  assert.deepEqual(firstGroup, { orientation: 0, groups: [{ size: 222 }, { size: 220 }, { size: 953 }] });

  const secondGroup = correctMinimizedEditorGroupWidth(layout, 2);
  assert.deepEqual(secondGroup, { orientation: 0, groups: [{ size: 220 }, { size: 222 }, { size: 953 }] });

  assert.equal(layout.groups[0].size, 220, 'The source layout must remain immutable.');
  assert.equal(layout.groups[1].size, 220, 'A non-target minimized group must remain unchanged.');
  assert.equal(firstGroup?.groups.reduce((total, group) => total + (group.size ?? 0), 0), 1395);
});

test('corrects the horizontal width carrier for a nested target leaf', () => {
  const layout = {
    orientation: 0,
    groups: [
      { size: 955 },
      { size: 220, groups: [{ size: 400 }, { size: 400 }] },
      { size: 220 },
    ],
  } as const;

  const result = correctMinimizedEditorGroupWidth(layout, 3);
  assert.deepEqual(result, {
    orientation: 0,
    groups: [
      { size: 953 },
      { size: 222, groups: [{ size: 400 }, { size: 400 }] },
      { size: 220 },
    ],
  });
});

test('skips minimum-width correction when the target or layout is unsafe', () => {
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 221 }, { size: 955 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 222 }, { size: 955 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 320 }, { size: 220 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 220 }, { size: 220 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 1, groups: [{ size: 220 }, { size: 955 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 220 }, { size: 955 }] }, 3), undefined);
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
