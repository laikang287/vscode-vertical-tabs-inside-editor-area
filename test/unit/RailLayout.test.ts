import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctMinimizedEditorGroupWidth,
  countLayoutLeaves,
  findLayoutLeafPath,
  getEditorGroupWidth,
  getRailGroupRatio,
  insertRailPreservingEditorWidths,
  isEditorLayout,
  MAX_PERSISTED_RAIL_RATIO,
  MIN_RAIL_WIDTH,
  normalizeRailWidth,
  prependRailToLayout,
  prependRailPreservingEditorWidths,
  removeRailRestoringEditorWidths,
  resolveRailRatio,
  setRailRootGroupWidth,
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

test('takes a new rail width only from the original leading editor column', () => {
  const layout = {
    orientation: 0,
    groups: [
      { size: 800, groups: [{ size: 320 }, { size: 480 }] },
      { size: 300 },
      { size: 500 },
    ],
  } as const;

  const result = prependRailPreservingEditorWidths(layout, 320);
  assert.deepEqual(result, {
    orientation: 0,
    groups: [
      { size: 320 },
      { size: 480, groups: [{ size: 320 }, { size: 480 }] },
      { size: 300 },
      { size: 500 },
    ],
  });
  assert.deepEqual(layout.groups.map((group) => group.size), [800, 300, 500], 'The captured layout must remain immutable.');
});

test('limits the rail to preserve the native minimum width of the original leading group', () => {
  assert.deepEqual(
    prependRailPreservingEditorWidths({ orientation: 0, groups: [{ size: 500 }, { size: 600 }] }, 400),
    { orientation: 0, groups: [{ size: 280 }, { size: 220 }, { size: 600 }] },
  );
  assert.deepEqual(
    prependRailPreservingEditorWidths({ orientation: 0, groups: [{ size: 400 }, { size: 600 }] }, 300),
    { orientation: 0, groups: [{ size: 300 }, { size: 400 }, { size: 300 }] },
  );
  assert.equal(
    prependRailPreservingEditorWidths({ orientation: 1, groups: [{ size: 500 }, { size: 500 }] }, 300),
    undefined,
  );
});

test('takes a new right rail width only from the original trailing editor column', () => {
  const layout = {
    orientation: 0,
    groups: [
      { size: 500 },
      { size: 300 },
      { size: 800, groups: [{ size: 320 }, { size: 480 }] },
    ],
  } as const;

  const result = insertRailPreservingEditorWidths(layout, 320, 'right');
  assert.deepEqual(result, {
    orientation: 0,
    groups: [
      { size: 500 },
      { size: 300 },
      { size: 480, groups: [{ size: 320 }, { size: 480 }] },
      { size: 320 },
    ],
  });
  assert.deepEqual(layout.groups.map((group) => group.size), [500, 300, 800]);
});

test('preserves a minimized edge group and takes left or right rail width from the widest group', () => {
  const leftLayout = {
    orientation: 0,
    groups: [
      { size: 220 },
      { size: 955, groups: [{ size: 400 }, { size: 555 }] },
    ],
  } as const;
  const rightLayout = {
    orientation: 0,
    groups: [
      { size: 955, groups: [{ size: 400 }, { size: 555 }] },
      { size: 220 },
    ],
  } as const;

  const left = insertRailPreservingEditorWidths(leftLayout, 320, 'left');
  assert.deepEqual(left, {
    orientation: 0,
    groups: [
      { size: 320 },
      { size: 220 },
      { size: 635, groups: [{ size: 400 }, { size: 555 }] },
    ],
  });

  const right = insertRailPreservingEditorWidths(rightLayout, 320, 'right');
  assert.deepEqual(right, {
    orientation: 0,
    groups: [
      { size: 635, groups: [{ size: 400 }, { size: 555 }] },
      { size: 220 },
      { size: 320 },
    ],
  });
  assert.deepEqual(leftLayout.groups.map((group) => group.size), [220, 955], 'The left source layout must remain immutable.');
  assert.deepEqual(rightLayout.groups.map((group) => group.size), [955, 220], 'The right source layout must remain immutable.');
});

test('combines widest-group slack without shrinking an editor below its native minimum', () => {
  const layout = {
    orientation: 0,
    groups: [{ size: 400 }, { size: 400 }, { size: 220 }],
  } as const;

  const result = insertRailPreservingEditorWidths(layout, 300, 'left');
  assert.deepEqual(result, {
    orientation: 0,
    groups: [{ size: 300 }, { size: 220 }, { size: 280 }, { size: 220 }],
  });
  assert.equal(result?.groups.reduce((total, group) => total + (group.size ?? 0), 0), 1020);
  assert.deepEqual(layout.groups.map((group) => group.size), [400, 400, 220]);
});

test('rejects a preserved insertion when total editor slack cannot provide a safe rail', () => {
  assert.equal(
    insertRailPreservingEditorWidths({ orientation: 0, groups: [{ size: 300 }, { size: 300 }] }, 280, 'left'),
    undefined,
  );
  assert.equal(
    insertRailPreservingEditorWidths({ orientation: 0, groups: [{ size: 220 }, { size: 400 }] }, 280, 'right'),
    undefined,
  );
});

test('returns a removed rail width to the editor groups that originally supplied it', () => {
  const leftLayout = {
    orientation: 0,
    groups: [{ size: 300 }, { size: 220 }, { size: 280 }, { size: 220 }],
  } as const;
  const rightLayout = {
    orientation: 0,
    groups: [{ size: 635, groups: [{ size: 400 }, { size: 555 }] }, { size: 220 }, { size: 320 }],
  } as const;

  assert.deepEqual(
    removeRailRestoringEditorWidths(leftLayout, 'left', [
      { editorGroupIndex: 0, contribution: 180 },
      { editorGroupIndex: 1, contribution: 120 },
    ]),
    { orientation: 0, groups: [{ size: 400 }, { size: 400 }, { size: 220 }] },
  );
  assert.deepEqual(
    removeRailRestoringEditorWidths(rightLayout, 'right', [
      { editorGroupIndex: 0, contribution: 320 },
    ]),
    {
      orientation: 0,
      groups: [{ size: 955, groups: [{ size: 400 }, { size: 555 }] }, { size: 220 }],
    },
  );
  assert.deepEqual(leftLayout.groups.map((group) => group.size), [300, 220, 280, 220]);
  assert.deepEqual(rightLayout.groups.map((group) => group.size), [635, 220, 320]);
});

test('returns a removed rail width only to the widest editor when contribution history is unavailable', () => {
  assert.deepEqual(
    removeRailRestoringEditorWidths(
      { orientation: 0, groups: [{ size: 260 }, { size: 220 }, { size: 700 }] },
      'left',
    ),
    { orientation: 0, groups: [{ size: 220 }, { size: 960 }] },
  );
  assert.deepEqual(
    removeRailRestoringEditorWidths(
      { orientation: 0, groups: [{ size: 500 }, { size: 500 }, { size: 240 }] },
      'right',
    ),
    { orientation: 0, groups: [{ size: 500 }, { size: 740 }] },
    'Equal widths should prefer the editor nearest the configured rail edge.',
  );
  assert.equal(
    removeRailRestoringEditorWidths({ orientation: 1, groups: [{ size: 300 }, { size: 700 }] }, 'left'),
    undefined,
  );
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

test('reads and persists the configured left or right edge rail ratio', () => {
  const leftLayout = { orientation: 0, groups: [{ size: 240 }, { size: 760 }] } as const;
  const rightLayout = { orientation: 0, groups: [{ size: 760 }, { size: 240 }] } as const;

  assert.equal(getRailGroupRatio(leftLayout, 'left'), 0.24);
  assert.equal(getRailGroupRatio(rightLayout, 'right'), 0.24);
  assert.equal(shouldPersistRailGroupRatio(leftLayout, 'left'), true);
  assert.equal(shouldPersistRailGroupRatio(leftLayout, 'right'), false);
  assert.equal(shouldPersistRailGroupRatio(rightLayout, 'right'), true);
  assert.equal(shouldPersistRailGroupRatio(rightLayout, 'left'), false);
  assert.equal(shouldPersistObservedRailWidth(rightLayout, 240, 'right'), true);
});

test('resizes either edge rail while preserving opposite root-group proportions and nesting', () => {
  const layout = {
    orientation: 0,
    groups: [
      { size: 200 },
      { size: 300, groups: [{ size: 120 }, { size: 180 }] },
      { size: 500 },
    ],
  } as const;

  const left = setRailRootGroupWidth(layout, 250, 'left');
  assert.deepEqual(left, {
    orientation: 0,
    groups: [
      { size: 250 },
      { size: 281, groups: [{ size: 120 }, { size: 180 }] },
      { size: 469 },
    ],
  });

  const right = setRailRootGroupWidth(layout, 250, 'right');
  assert.deepEqual(right, {
    orientation: 0,
    groups: [
      { size: 300 },
      { size: 450, groups: [{ size: 120 }, { size: 180 }] },
      { size: 250 },
    ],
  });
  assert.equal(setRailRootGroupWidth({ orientation: 1, groups: [{ size: 500 }, { size: 500 }] }, 250, 'right'), undefined);
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
