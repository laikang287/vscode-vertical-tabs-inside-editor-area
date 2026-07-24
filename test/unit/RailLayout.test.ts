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
  normalizeMinimizedEdgeEditorGroupWidth,
  nudgeNarrowEdgeEditorGroupWidth,
  prependRailToLayout,
  prependRailPreservingEditorWidths,
  removeRailPreservingCurrentEditorWidths,
  removeRailRestoringEditorWidths,
  resolveRailRatio,
  selectWidestEditorGroupViewColumn,
  setRailRootGroupWidth,
  setLeadingRailWidth,
  shouldPersistObservedRailWidth,
  shouldPersistRailGroupRatio,
  widenMinimizedEditorBesideRailBeforeHide,
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

test('preserves an exact 220px minimum edge group while creating a rail on either side', () => {
  assert.deepEqual(
    insertRailPreservingEditorWidths(
      { orientation: 0, groups: [{ size: 220 }, { size: 1280 }] },
      320,
      'left',
    ),
    { orientation: 0, groups: [{ size: 320 }, { size: 220 }, { size: 960 }] },
  );
  assert.deepEqual(
    insertRailPreservingEditorWidths(
      { orientation: 0, groups: [{ size: 1280 }, { size: 220 }] },
      320,
      'right',
    ),
    { orientation: 0, groups: [{ size: 960 }, { size: 220 }, { size: 320 }] },
  );
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

test('removes a rail snapshot without redistributing user editor widths', () => {
  const leftLayout = {
    orientation: 0,
    groups: [{ size: 222 }, { size: 220 }, { size: 845, groups: [{ size: 400 }, { size: 445 }] }],
  } as const;
  const rightLayout = {
    orientation: 0,
    groups: [{ size: 845, groups: [{ size: 400 }, { size: 445 }] }, { size: 220 }, { size: 222 }],
  } as const;

  assert.deepEqual(removeRailPreservingCurrentEditorWidths(leftLayout, 'left'), {
    orientation: 0,
    groups: [{ size: 220 }, { size: 845, groups: [{ size: 400 }, { size: 445 }] }],
  });
  assert.deepEqual(removeRailPreservingCurrentEditorWidths(rightLayout, 'right'), {
    orientation: 0,
    groups: [{ size: 845, groups: [{ size: 400 }, { size: 445 }] }, { size: 220 }],
  });
  assert.deepEqual(leftLayout.groups.map((group) => group.size), [222, 220, 845]);
  assert.deepEqual(rightLayout.groups.map((group) => group.size), [845, 220, 222]);
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

test('selects the widest group as the rail creation anchor without activating a 220px edge group', () => {
  const leftMinimized = { orientation: 0, groups: [{ size: 220 }, { size: 1280 }] } as const;
  const rightMinimized = { orientation: 0, groups: [{ size: 1280 }, { size: 220 }] } as const;

  assert.equal(selectWidestEditorGroupViewColumn(leftMinimized, [1, 2], 2), 2);
  assert.equal(selectWidestEditorGroupViewColumn(leftMinimized, [1, 2], 1), 2);
  assert.equal(selectWidestEditorGroupViewColumn(rightMinimized, [1, 2], 1), 1);
  assert.equal(selectWidestEditorGroupViewColumn(rightMinimized, [1, 2], 2), 1);
});

test('nudges a 220px edge group to 223px before rail creation on either side', () => {
  const leftLayout = {
    orientation: 0,
    groups: [{ size: 220 }, { size: 1280, groups: [{ size: 500 }, { size: 780 }] }],
  } as const;
  const rightLayout = {
    orientation: 0,
    groups: [{ size: 1280, groups: [{ size: 500 }, { size: 780 }] }, { size: 220 }],
  } as const;

  assert.deepEqual(nudgeNarrowEdgeEditorGroupWidth(leftLayout, 'left', 3), {
    orientation: 0,
    groups: [{ size: 223 }, { size: 1277, groups: [{ size: 500 }, { size: 780 }] }],
  });
  assert.deepEqual(nudgeNarrowEdgeEditorGroupWidth(rightLayout, 'right', 3), {
    orientation: 0,
    groups: [{ size: 1277, groups: [{ size: 500 }, { size: 780 }] }, { size: 223 }],
  });
  assert.deepEqual(nudgeNarrowEdgeEditorGroupWidth(leftLayout, 'left', 4), {
    orientation: 0,
    groups: [{ size: 224 }, { size: 1276, groups: [{ size: 500 }, { size: 780 }] }],
  });
  assert.deepEqual(leftLayout.groups.map((group) => group.size), [220, 1280]);
  assert.deepEqual(rightLayout.groups.map((group) => group.size), [1280, 220]);
});

test('normalizes a minimized final edge group to 223px on either side', () => {
  const leftLayout = {
    orientation: 0,
    groups: [{ size: 220 }, { size: 640 }, { size: 640, groups: [{ size: 300 }, { size: 340 }] }],
  } as const;
  const rightLayout = {
    orientation: 0,
    groups: [{ size: 640, groups: [{ size: 300 }, { size: 340 }] }, { size: 640 }, { size: 220 }],
  } as const;

  assert.deepEqual(normalizeMinimizedEdgeEditorGroupWidth(leftLayout, 'left'), {
    orientation: 0,
    groups: [{ size: 223 }, { size: 637 }, { size: 640, groups: [{ size: 300 }, { size: 340 }] }],
  });
  assert.deepEqual(normalizeMinimizedEdgeEditorGroupWidth(rightLayout, 'right'), {
    orientation: 0,
    groups: [{ size: 640, groups: [{ size: 300 }, { size: 340 }] }, { size: 637 }, { size: 223 }],
  });
  assert.equal(
    leftLayout.groups.reduce((total, group) => total + group.size, 0),
    normalizeMinimizedEdgeEditorGroupWidth(leftLayout, 'left')?.groups
      .reduce((total, group) => total + (group.size ?? 0), 0),
  );
  assert.deepEqual(leftLayout.groups.map((group) => group.size), [220, 640, 640]);
  assert.deepEqual(rightLayout.groups.map((group) => group.size), [640, 640, 220]);
});

test('refuses final minimized-edge normalization without a safe donor', () => {
  assert.equal(
    normalizeMinimizedEdgeEditorGroupWidth(
      { orientation: 0, groups: [{ size: 220 }, { size: 224 }] },
      'left',
    ),
    undefined,
  );
  assert.equal(
    normalizeMinimizedEdgeEditorGroupWidth(
      { orientation: 0, groups: [{ size: 224 }, { size: 220 }] },
      'right',
    ),
    undefined,
  );
  assert.equal(
    normalizeMinimizedEdgeEditorGroupWidth(
      { orientation: 1, groups: [{ size: 220 }, { size: 1280 }] },
      'left',
    ),
    undefined,
  );
});

test('widens the 220px editor beside either rail to 223px before hiding', () => {
  const leftLayout = {
    orientation: 0,
    groups: [{ size: 222 }, { size: 220 }, { size: 1000, groups: [{ size: 400 }, { size: 600 }] }],
  } as const;
  const rightLayout = {
    orientation: 0,
    groups: [{ size: 1000, groups: [{ size: 400 }, { size: 600 }] }, { size: 220 }, { size: 222 }],
  } as const;

  assert.deepEqual(widenMinimizedEditorBesideRailBeforeHide(leftLayout, 'left'), {
    orientation: 0,
    groups: [{ size: 222 }, { size: 223 }, { size: 997, groups: [{ size: 400 }, { size: 600 }] }],
  });
  assert.deepEqual(widenMinimizedEditorBesideRailBeforeHide(rightLayout, 'right'), {
    orientation: 0,
    groups: [{ size: 997, groups: [{ size: 400 }, { size: 600 }] }, { size: 223 }, { size: 222 }],
  });
  assert.deepEqual(leftLayout.groups.map((group) => group.size), [222, 220, 1000]);
  assert.deepEqual(rightLayout.groups.map((group) => group.size), [1000, 220, 222]);
});

test('combines safe donors for the 223px pre-hide width without minimizing any group', () => {
  assert.deepEqual(
    widenMinimizedEditorBesideRailBeforeHide(
      { orientation: 0, groups: [{ size: 223 }, { size: 220 }, { size: 224 }] },
      'left',
    ),
    { orientation: 0, groups: [{ size: 222 }, { size: 223 }, { size: 222 }] },
  );
  assert.equal(
    widenMinimizedEditorBesideRailBeforeHide(
      { orientation: 0, groups: [{ size: 222 }, { size: 220 }, { size: 224 }] },
      'left',
    ),
    undefined,
  );
  assert.equal(
    widenMinimizedEditorBesideRailBeforeHide(
      { orientation: 0, groups: [{ size: 500 }, { size: 221 }, { size: 222 }] },
      'right',
    ),
    undefined,
  );
});

test('skips the pre-creation edge nudge when the layout or donor is unsafe', () => {
  assert.equal(
    nudgeNarrowEdgeEditorGroupWidth({ orientation: 0, groups: [{ size: 221 }, { size: 1179 }] }, 'left'),
    undefined,
  );
  assert.equal(
    nudgeNarrowEdgeEditorGroupWidth({ orientation: 0, groups: [{ size: 220 }, { size: 224 }] }, 'right', 3),
    undefined,
  );
  assert.equal(
    nudgeNarrowEdgeEditorGroupWidth({ orientation: 1, groups: [{ size: 220 }, { size: 1280 }] }, 'left'),
    undefined,
  );
});

test('prefers the active group only when rail creation anchor widths tie', () => {
  const layout = { orientation: 0, groups: [{ size: 600 }, { size: 600 }, { size: 220 }] } as const;

  assert.equal(selectWidestEditorGroupViewColumn(layout, [1, 2, 3], 2), 2);
  assert.equal(selectWidestEditorGroupViewColumn(layout, [1, 2, 3], 3), 1);
  assert.equal(selectWidestEditorGroupViewColumn(layout, [4], 4), undefined);
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

test('never creates a new minimized sibling while correcting the rail width', () => {
  const protectedAdjacent = {
    orientation: 0,
    groups: [{ size: 220 }, { size: 222 }, { size: 700 }],
  } as const;
  assert.deepEqual(correctMinimizedEditorGroupWidth(protectedAdjacent, 1), {
    orientation: 0,
    groups: [{ size: 222 }, { size: 222 }, { size: 698 }],
  });
  assert.deepEqual(
    correctMinimizedEditorGroupWidth(
      { orientation: 0, groups: [{ size: 700 }, { size: 222 }, { size: 220 }] },
      3,
    ),
    { orientation: 0, groups: [{ size: 698 }, { size: 222 }, { size: 222 }] },
  );

  const sharedDonation = {
    orientation: 0,
    groups: [{ size: 220 }, { size: 223 }, { size: 223 }],
  } as const;
  assert.deepEqual(correctMinimizedEditorGroupWidth(sharedDonation, 1), {
    orientation: 0,
    groups: [{ size: 222 }, { size: 222 }, { size: 222 }],
  });
  assert.deepEqual(sharedDonation.groups.map((group) => group.size), [220, 223, 223]);
});

test('skips minimum-width correction when the target or layout is unsafe', () => {
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 221 }, { size: 955 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 222 }, { size: 955 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 320 }, { size: 220 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 220 }, { size: 220 }] }, 1), undefined);
  assert.equal(correctMinimizedEditorGroupWidth({ orientation: 0, groups: [{ size: 220 }, { size: 222 }] }, 1), undefined);
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
