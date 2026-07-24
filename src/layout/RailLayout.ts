export const MIN_RAIL_WIDTH = 180;
export const DEFAULT_RAIL_WIDTH = 280;
export const DEFAULT_RAIL_RATIO = 0.2;
export const MIN_RAIL_RATIO = 0.1;
export const MAX_RAIL_RATIO = 0.5;
export const FULL_WIDTH_RAIL_RATIO = 0.9;
export const MAX_PERSISTED_RAIL_RATIO = 0.3;
export const VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH = 220;
export const SAFE_RAIL_WIDTH = 222;
export const SAFE_MINIMIZED_EDITOR_GROUP_WIDTH = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH + 3;

export type RailPosition = 'left' | 'right';

export interface RailWidthContribution {
  readonly editorGroupIndex: number;
  readonly contribution: number;
}

export interface EditorLayoutGroup {
  readonly size?: number;
  readonly groups?: readonly EditorLayoutGroup[];
}

export interface EditorLayout {
  readonly orientation?: number;
  readonly groups: readonly EditorLayoutGroup[];
}

export function normalizeRailWidth(value: unknown, fallback = DEFAULT_RAIL_WIDTH): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(MIN_RAIL_WIDTH, Math.round(value));
}

/** Adds a full-height left rail without changing the existing editor layout tree. */
export function prependRailToLayout(layout: EditorLayout, width: number): EditorLayout {
  const rail = { size: normalizeRailWidth(width) };
  const copiedGroups = layout.groups.map(copyGroup);

  if (layout.orientation === 0) {
    return { orientation: 0, groups: [rail, ...copiedGroups] };
  }

  // A vertical root needs to be wrapped so that the rail remains full height.
  return {
    orientation: 0,
    groups: [rail, { groups: copiedGroups }],
  };
}

/**
 * Prepends a rail while taking its width only from the original leading
 * horizontal editor column. Later columns and all nested split sizes are kept
 * unchanged. Returns undefined when the leading column cannot safely provide
 * enough room for both the rail and the original editor group.
 */
export function prependRailPreservingEditorWidths(
  layout: EditorLayout,
  width: number,
  minimumRailWidth = SAFE_RAIL_WIDTH,
  minimumEditorWidth = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
): EditorLayout | undefined {
  return insertRailPreservingEditorWidths(layout, width, 'left', minimumRailWidth, minimumEditorWidth);
}

/**
 * Adds a rail at the configured edge while taking its width only from the
 * original editor group at that edge whenever it can provide a safe rail.
 * Otherwise, width is taken from the widest root groups without shrinking any
 * editor group below VS Code's native minimum. Nested sizes are preserved.
 */
export function insertRailPreservingEditorWidths(
  layout: EditorLayout,
  width: number,
  position: RailPosition,
  minimumRailWidth = SAFE_RAIL_WIDTH,
  minimumEditorWidth = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
): EditorLayout | undefined {
  if ((layout.orientation ?? 0) !== 0 || layout.groups.length === 0) {
    return undefined;
  }

  const edgeIndex = position === 'left' ? 0 : layout.groups.length - 1;
  const requestedRailWidth = Math.max(minimumRailWidth, normalizeRailWidth(width));
  const donors = layout.groups.flatMap((group, index) => {
    const groupWidth = group.size;
    if (typeof groupWidth !== 'number' || !Number.isFinite(groupWidth) || groupWidth <= 0) {
      return [];
    }
    const availableWidth = Math.max(0, Math.floor(groupWidth - minimumEditorWidth));
    return [{ index, groupWidth, availableWidth }];
  });
  const edgeDonor = donors.find((donor) => donor.index === edgeIndex);
  const orderedDonors = edgeDonor && edgeDonor.availableWidth >= minimumRailWidth
    ? [edgeDonor]
    : donors
      .filter((donor) => donor.availableWidth > 0)
      .sort((left, right) => {
        if (right.availableWidth !== left.availableWidth) {
          return right.availableWidth - left.availableWidth;
        }
        const leftDistance = position === 'left' ? left.index : layout.groups.length - 1 - left.index;
        const rightDistance = position === 'left' ? right.index : layout.groups.length - 1 - right.index;
        return leftDistance - rightDistance;
      });
  const availableRailWidth = orderedDonors.reduce((sum, donor) => sum + donor.availableWidth, 0);
  const railWidth = Math.min(requestedRailWidth, availableRailWidth);
  if (railWidth < minimumRailWidth) {
    return undefined;
  }

  let remainingRailWidth = railWidth;
  const resizedGroups = layout.groups.map(copyGroup);
  for (const donor of orderedDonors) {
    if (remainingRailWidth <= 0) break;
    const contribution = Math.min(remainingRailWidth, donor.availableWidth);
    resizedGroups[donor.index] = {
      ...resizedGroups[donor.index],
      size: donor.groupWidth - contribution,
    };
    remainingRailWidth -= contribution;
  }
  const rail = { size: railWidth };
  return {
    orientation: 0,
    groups: position === 'left'
      ? [rail, ...resizedGroups]
      : [...resizedGroups, rail],
  };
}

/**
 * Removes an edge rail and returns its width to the editor groups that
 * originally supplied it. When no valid contribution history is available,
 * the widest editor group receives the released width so native proportional
 * redistribution is avoided.
 */
export function removeRailRestoringEditorWidths(
  layout: EditorLayout,
  position: RailPosition,
  contributions: readonly RailWidthContribution[] = [],
): EditorLayout | undefined {
  if ((layout.orientation ?? 0) !== 0 || layout.groups.length < 2) {
    return undefined;
  }

  const railIndex = position === 'left' ? 0 : layout.groups.length - 1;
  const railWidth = layout.groups[railIndex]?.size;
  if (typeof railWidth !== 'number' || !Number.isFinite(railWidth) || railWidth <= 0) {
    return undefined;
  }

  const editorGroups = layout.groups
    .filter((_, index) => index !== railIndex)
    .map(copyGroup);
  const contributionByIndex = new Map<number, number>();
  for (const item of contributions) {
    const editorWidth = editorGroups[item.editorGroupIndex]?.size;
    if (
      !Number.isInteger(item.editorGroupIndex)
      || item.editorGroupIndex < 0
      || typeof item.contribution !== 'number'
      || !Number.isFinite(item.contribution)
      || item.contribution <= 0
      || typeof editorWidth !== 'number'
      || !Number.isFinite(editorWidth)
      || editorWidth <= 0
    ) {
      continue;
    }
    contributionByIndex.set(
      item.editorGroupIndex,
      (contributionByIndex.get(item.editorGroupIndex) ?? 0) + item.contribution,
    );
  }

  let recipients = [...contributionByIndex.entries()].map(([index, weight]) => ({ index, weight }));
  if (recipients.length === 0) {
    recipients = editorGroups
      .flatMap((group, index) => (
        typeof group.size === 'number' && Number.isFinite(group.size) && group.size > 0
          ? [{ index, weight: group.size }]
          : []
      ))
      .sort((left, right) => {
        if (right.weight !== left.weight) return right.weight - left.weight;
        const leftDistance = position === 'left' ? left.index : editorGroups.length - 1 - left.index;
        const rightDistance = position === 'left' ? right.index : editorGroups.length - 1 - right.index;
        return leftDistance - rightDistance;
      })
      .slice(0, 1);
  }
  if (recipients.length === 0) {
    return undefined;
  }

  let remainingWidth = railWidth;
  let remainingWeight = recipients.reduce((sum, recipient) => sum + recipient.weight, 0);
  recipients.forEach((recipient, index) => {
    const editorGroup = editorGroups[recipient.index];
    const editorWidth = editorGroup?.size;
    if (typeof editorWidth !== 'number' || !Number.isFinite(editorWidth)) return;
    const returnedWidth = index === recipients.length - 1
      ? remainingWidth
      : Math.round(remainingWidth * recipient.weight / remainingWeight);
    editorGroups[recipient.index] = { ...editorGroup, size: editorWidth + returnedWidth };
    remainingWidth -= returnedWidth;
    remainingWeight -= recipient.weight;
  });

  return { orientation: 0, groups: editorGroups };
}

/**
 * Removes the root rail without redistributing its width. This is used to
 * compare the current user-editor layout with the post-Show snapshot before
 * deciding whether saved width-contribution history is still valid.
 */
export function removeRailPreservingCurrentEditorWidths(
  layout: EditorLayout,
  position: RailPosition,
): EditorLayout | undefined {
  if ((layout.orientation ?? 0) !== 0 || layout.groups.length < 2) {
    return undefined;
  }

  const railIndex = position === 'left' ? 0 : layout.groups.length - 1;
  const railWidth = layout.groups[railIndex]?.size;
  if (typeof railWidth !== 'number' || !Number.isFinite(railWidth) || railWidth <= 0) {
    return undefined;
  }

  return {
    orientation: 0,
    groups: layout.groups
      .filter((_, index) => index !== railIndex)
      .map(copyGroup),
  };
}

/** Updates the first leaf, which is the rail after it has been moved left. */
export function setLeadingRailWidth(layout: EditorLayout, width: number): EditorLayout {
  let updated = false;
  const update = (group: EditorLayoutGroup): EditorLayoutGroup => {
    if (group.groups && group.groups.length > 0) {
      return { ...group, groups: group.groups.map(update) };
    }
    if (!updated) {
      updated = true;
      return { ...group, size: normalizeRailWidth(width) };
    }
    return copyGroup(group);
  };

  return { orientation: layout.orientation, groups: layout.groups.map(update) };
}

/**
 * Returns the depth-first layout path for the editor group addressed by its
 * one-based VS Code view column. VS Code assigns view columns in the same grid
 * appearance order used to serialize editor layout leaves.
 */
export function findLayoutLeafPath(layout: EditorLayout, viewColumn: number): readonly number[] | undefined {
  if (!Number.isInteger(viewColumn) || viewColumn < 1) {
    return undefined;
  }

  let remaining = viewColumn - 1;
  const visit = (groups: readonly EditorLayoutGroup[], parentPath: readonly number[]): readonly number[] | undefined => {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const path = [...parentPath, index];
      if (group.groups && group.groups.length > 0) {
        const nested = visit(group.groups, path);
        if (nested) return nested;
        continue;
      }
      if (remaining === 0) return path;
      remaining -= 1;
    }
    return undefined;
  };

  return visit(layout.groups, []);
}

/** Returns the width assigned by the deepest horizontal split for a group. */
export function getEditorGroupWidth(layout: EditorLayout, viewColumn: number): number | undefined {
  const location = findHorizontalWidthLocation(layout, viewColumn);
  const width = location?.groups[location.targetIndex]?.size;
  return typeof width === 'number' && Number.isFinite(width) ? width : undefined;
}

/**
 * Chooses a wide editor group as the temporary anchor used to create a new
 * rail group. Activating an existing minimized group can make VS Code expand
 * it, so the active group is only preferred when it ties for the widest width.
 */
export function selectWidestEditorGroupViewColumn(
  layout: EditorLayout,
  viewColumns: readonly number[],
  activeViewColumn?: number,
): number | undefined {
  const candidates = viewColumns.flatMap((viewColumn) => {
    const width = getEditorGroupWidth(layout, viewColumn);
    return typeof width === 'number' && Number.isFinite(width) && width > 0
      ? [{ viewColumn, width }]
      : [];
  });
  candidates.sort((left, right) => {
    if (right.width !== left.width) {
      return right.width - left.width;
    }
    if (left.viewColumn === activeViewColumn) return -1;
    if (right.viewColumn === activeViewColumn) return 1;
    return left.viewColumn - right.viewColumn;
  });
  return candidates[0]?.viewColumn;
}

/**
 * Moves a narrow edge editor group just above its minimized width before VS
 * Code creates the rail group. The delta is taken from the widest other root
 * group so total width, ordering, and nested layout content remain unchanged.
 */
export function nudgeNarrowEdgeEditorGroupWidth(
  layout: EditorLayout,
  position: RailPosition,
  delta = 1,
  maximumNarrowWidth = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
  minimumDonorWidth = SAFE_RAIL_WIDTH,
): EditorLayout | undefined {
  if (
    (layout.orientation ?? 0) !== 0
    || layout.groups.length < 2
    || !Number.isFinite(delta)
    || delta <= 0
  ) {
    return undefined;
  }

  const edgeIndex = position === 'left' ? 0 : layout.groups.length - 1;
  const edgeWidth = layout.groups[edgeIndex]?.size;
  if (
    typeof edgeWidth !== 'number'
    || !Number.isFinite(edgeWidth)
    || edgeWidth <= 0
    || edgeWidth > maximumNarrowWidth
  ) {
    return undefined;
  }

  const donor = layout.groups
    .flatMap((group, index) => {
      const width = group.size;
      return index !== edgeIndex
        && typeof width === 'number'
        && Number.isFinite(width)
        && width - delta >= Math.max(edgeWidth, minimumDonorWidth)
        ? [{ index, width }]
        : [];
    })
    .sort((left, right) => right.width - left.width || left.index - right.index)[0];
  if (!donor) {
    return undefined;
  }

  return {
    ...layout,
    groups: layout.groups.map((group, index) => {
      if (index === edgeIndex) return { ...copyGroup(group), size: edgeWidth + delta };
      if (index === donor.index) return { ...copyGroup(group), size: donor.width - delta };
      return copyGroup(group);
    }),
  };
}

/**
 * Normalizes a user editor at VS Code's minimized 220px edge to 223px in the
 * final layout after the rail has been removed. The pixel comes from the
 * widest safe root group, preferring the donor nearest the configured edge
 * when widths tie. Root width, order, and nested content remain unchanged.
 */
export function normalizeMinimizedEdgeEditorGroupWidth(
  layout: EditorLayout,
  position: RailPosition,
  minimizedWidth = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
  safeWidth = SAFE_MINIMIZED_EDITOR_GROUP_WIDTH,
): EditorLayout | undefined {
  if (
    (layout.orientation ?? 0) !== 0
    || layout.groups.length < 2
    || !Number.isFinite(minimizedWidth)
    || !Number.isFinite(safeWidth)
    || minimizedWidth <= 0
    || safeWidth <= minimizedWidth
  ) {
    return undefined;
  }

  const edgeIndex = position === 'left' ? 0 : layout.groups.length - 1;
  if (layout.groups[edgeIndex]?.size !== minimizedWidth) {
    return undefined;
  }

  const delta = safeWidth - minimizedWidth;
  const donor = layout.groups
    .flatMap((group, index) => {
      const width = group.size;
      return index !== edgeIndex
        && typeof width === 'number'
        && Number.isFinite(width)
        && width - delta >= SAFE_RAIL_WIDTH
        ? [{ index, width }]
        : [];
    })
    .sort((left, right) => {
      if (right.width !== left.width) return right.width - left.width;
      const leftDistance = position === 'left' ? left.index : layout.groups.length - 1 - left.index;
      const rightDistance = position === 'left' ? right.index : layout.groups.length - 1 - right.index;
      return leftDistance - rightDistance;
    })[0];
  if (!donor) {
    return undefined;
  }

  return {
    ...layout,
    groups: layout.groups.map((group, index) => {
      if (index === edgeIndex) return { ...copyGroup(group), size: safeWidth };
      if (index === donor.index) return { ...copyGroup(group), size: donor.width - delta };
      return copyGroup(group);
    }),
  };
}

/**
 * Temporarily widens the user editor directly beside an existing rail from
 * VS Code's minimized 220px width before the rail is hidden. Width comes from
 * safe root-level siblings,
 * preferring user editors and using the rail only as a last resort. No donor
 * is allowed to fall below the safe width.
 */
export function widenMinimizedEditorBesideRailBeforeHide(
  layout: EditorLayout,
  position: RailPosition,
  targetWidth = SAFE_MINIMIZED_EDITOR_GROUP_WIDTH,
  minimizedWidth = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
  minimumDonorWidth = SAFE_RAIL_WIDTH,
): EditorLayout | undefined {
  if (
    (layout.orientation ?? 0) !== 0
    || layout.groups.length < 2
    || !Number.isFinite(targetWidth)
    || !Number.isFinite(minimizedWidth)
    || targetWidth <= minimizedWidth
  ) {
    return undefined;
  }

  const railIndex = position === 'left' ? 0 : layout.groups.length - 1;
  const adjacentIndex = position === 'left' ? 1 : layout.groups.length - 2;
  if (layout.groups[adjacentIndex]?.size !== minimizedWidth) {
    return undefined;
  }

  const requiredWidth = targetWidth - minimizedWidth;
  const donors = layout.groups
    .flatMap((group, index) => {
      const size = group.size;
      if (index === adjacentIndex || typeof size !== 'number' || !Number.isFinite(size)) {
        return [];
      }
      const availableWidth = Math.max(0, Math.floor(size - minimumDonorWidth));
      return availableWidth > 0 ? [{ index, size, availableWidth, isRail: index === railIndex }] : [];
    })
    .sort((left, right) => (
      Number(left.isRail) - Number(right.isRail)
      || right.availableWidth - left.availableWidth
      || right.size - left.size
    ));
  if (donors.reduce((total, donor) => total + donor.availableWidth, 0) < requiredWidth) {
    return undefined;
  }

  let remainingWidth = requiredWidth;
  const contributionByIndex = new Map<number, number>();
  for (const donor of donors) {
    if (remainingWidth <= 0) break;
    const contribution = Math.min(remainingWidth, donor.availableWidth);
    contributionByIndex.set(donor.index, contribution);
    remainingWidth -= contribution;
  }

  return {
    ...layout,
    groups: layout.groups.map((group, index) => {
      if (index === adjacentIndex) return { ...copyGroup(group), size: targetWidth };
      const contribution = contributionByIndex.get(index);
      if (contribution !== undefined && typeof group.size === 'number') {
        return { ...copyGroup(group), size: group.size - contribution };
      }
      return copyGroup(group);
    }),
  };
}

/**
 * Nudges only the editor group identified by `viewColumn` above VS Code's
 * native minimized width. The size is taken from the deepest horizontal split
 * that controls the target leaf's width. One or more widest siblings may
 * contribute, but no donor is allowed to become a new minimized group.
 */
export function correctMinimizedEditorGroupWidth(
  layout: EditorLayout,
  viewColumn: number,
  minimizedWidth = VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH,
  safeWidth = SAFE_RAIL_WIDTH,
): EditorLayout | undefined {
  const location = findHorizontalWidthLocation(layout, viewColumn);
  if (!location || safeWidth <= minimizedWidth) {
    return undefined;
  }
  const { groups: horizontalGroups, parentPath: horizontalParentPath, targetIndex: horizontalTargetIndex } = location;
  if (horizontalGroups[horizontalTargetIndex]?.size !== minimizedWidth) {
    return undefined;
  }

  const delta = safeWidth - minimizedWidth;
  const donors = horizontalGroups
    .flatMap((group, index) => {
      const size = group.size;
      if (index === horizontalTargetIndex || typeof size !== 'number' || !Number.isFinite(size)) {
        return [];
      }
      const availableWidth = Math.max(0, Math.floor(size - safeWidth));
      return availableWidth > 0 ? [{ index, size, availableWidth }] : [];
    })
    .sort((left, right) => (
      right.availableWidth - left.availableWidth
      || right.size - left.size
      || Math.abs(right.index - horizontalTargetIndex) - Math.abs(left.index - horizontalTargetIndex)
    ));
  if (donors.reduce((total, donor) => total + donor.availableWidth, 0) < delta) {
    return undefined;
  }

  let remainingWidth = delta;
  const contributionByIndex = new Map<number, number>();
  for (const donor of donors) {
    if (remainingWidth <= 0) break;
    const contribution = Math.min(remainingWidth, donor.availableWidth);
    contributionByIndex.set(donor.index, contribution);
    remainingWidth -= contribution;
  }

  return {
    ...layout,
    groups: updateGroupsAtPath(layout.groups, horizontalParentPath, (siblings) => siblings.map((group, index) => {
      if (index === horizontalTargetIndex) return { ...group, size: safeWidth };
      const contribution = contributionByIndex.get(index);
      if (contribution !== undefined && typeof group.size === 'number') {
        return { ...group, size: group.size - contribution };
      }
      return copyGroup(group);
    })),
  };
}

export function countLayoutLeaves(layout: EditorLayout | EditorLayoutGroup): number {
  if (!layout.groups || layout.groups.length === 0) {
    return 1;
  }
  return layout.groups.reduce((count, group) => count + countLayoutLeaves(group), 0);
}

export function normalizeRailRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RAIL_RATIO;
  }
  return Math.min(MAX_RAIL_RATIO, Math.max(MIN_RAIL_RATIO, value));
}

export function resolveRailRatio(savedRatio: unknown, configuredRatio: unknown): number {
  return normalizeRailRatio(typeof savedRatio === 'number' ? savedRatio : configuredRatio);
}

export function hasSeparateEditorArea(layout: EditorLayout | undefined): layout is EditorLayout {
  return layout?.orientation === 0 && layout.groups.length >= 2;
}

export function getEditorAreaWidth(layout: EditorLayout | undefined): number {
  if (layout) {
    const rootSizes = layout.groups.map((group) => group.size);
    if (rootSizes.length > 0 && rootSizes.every((size): size is number => typeof size === 'number' && size > 1)) {
      if (layout.orientation === 0 || rootSizes.length === 1) {
        return Math.max(2, Math.round(rootSizes.reduce((sum, size) => sum + size, 0)));
      }
    }
  }
  // setEditorLayout accepts relative sizes as well as the pixel sizes returned
  // by getEditorLayout. Integer weights avoid fractional sizes being clamped by
  // recent VS Code versions before their ratio is applied.
  return 1000;
}

export function getObservedRailRatio(layout: EditorLayout | undefined, railWidth: number | undefined): number | undefined {
  if (typeof railWidth !== 'number' || !Number.isFinite(railWidth) || railWidth <= 0) {
    return undefined;
  }
  const totalWidth = getEditorAreaWidth(layout);
  return totalWidth > 0 ? railWidth / totalWidth : undefined;
}

export function getRailGroupRatio(layout: EditorLayout, position: RailPosition = 'left'): number | undefined {
  if (!hasSeparateEditorArea(layout)) {
    return undefined;
  }
  const sizes = layout.groups.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0)) {
    return undefined;
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0 ? sizes[getRailRootGroupIndex(layout, position)] / total : undefined;
}

export function shouldPersistObservedRailWidth(
  layout: EditorLayout | undefined,
  railWidth: number | undefined,
  position: RailPosition = 'left',
): boolean {
  if (!hasUsableEditorAreaOppositeRail(layout, position)) {
    return false;
  }
  const ratio = getObservedRailRatio(layout, railWidth);
  return isPersistableRailRatio(ratio);
}

export function shouldPersistRailGroupRatio(
  layout: EditorLayout | undefined,
  position: RailPosition = 'left',
): boolean {
  if (!hasUsableEditorAreaOppositeRail(layout, position)) {
    return false;
  }
  const ratio = getRailGroupRatio(layout, position);
  return isPersistableRailRatio(ratio);
}

export function getRailRootGroupIndex(layout: EditorLayout, position: RailPosition): number {
  return position === 'left' ? 0 : Math.max(0, layout.groups.length - 1);
}

export function setRailRootGroupWidth(
  layout: EditorLayout,
  width: number,
  position: RailPosition,
): EditorLayout | undefined {
  if (layout.orientation !== 0 || layout.groups.length < 2) {
    return undefined;
  }

  const railIndex = getRailRootGroupIndex(layout, position);
  const railWidth = normalizeRailWidth(width);
  const siblingIndexes = layout.groups.map((_, index) => index).filter((index) => index !== railIndex);
  const siblingWidths = siblingIndexes.map((index) => {
    const size = layout.groups[index]?.size;
    return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 1;
  });
  const siblingTotal = siblingWidths.reduce((sum, size) => sum + size, 0);
  const availableWidth = Math.max(1, getEditorAreaWidth(layout) - railWidth);
  let siblingOffset = 0;

  return {
    ...layout,
    groups: layout.groups.map((group, index) => {
      if (index === railIndex) {
        return { ...group, size: railWidth };
      }
      const siblingWidth = siblingWidths[siblingOffset] ?? 1;
      siblingOffset += 1;
      return {
        ...group,
        size: Math.max(1, Math.round(availableWidth * siblingWidth / siblingTotal)),
      };
    }),
  };
}

export function isEditorLayout(value: unknown): value is EditorLayout {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Array.isArray((value as Partial<EditorLayout>).groups);
}

function copyGroup(group: EditorLayoutGroup): EditorLayoutGroup {
  return {
    ...(typeof group.size === 'number' ? { size: group.size } : {}),
    ...(group.groups ? { groups: group.groups.map(copyGroup) } : {}),
  };
}

function findHorizontalWidthLocation(layout: EditorLayout, viewColumn: number): {
  readonly groups: readonly EditorLayoutGroup[];
  readonly parentPath: readonly number[];
  readonly targetIndex: number;
} | undefined {
  const leafPath = findLayoutLeafPath(layout, viewColumn);
  if (!leafPath) return undefined;

  let groups = layout.groups;
  let orientation = layout.orientation ?? 0;
  let result: { readonly groups: readonly EditorLayoutGroup[]; readonly parentPath: readonly number[]; readonly targetIndex: number } | undefined;
  for (let depth = 0; depth < leafPath.length; depth += 1) {
    const index = leafPath[depth];
    const group = groups[index];
    if (!group) return undefined;
    if (orientation === 0) {
      result = { groups, parentPath: leafPath.slice(0, depth), targetIndex: index };
    }
    if (depth < leafPath.length - 1) {
      if (!group.groups || group.groups.length === 0) return undefined;
      groups = group.groups;
      orientation = orientation === 0 ? 1 : 0;
    }
  }
  return result;
}

function updateGroupsAtPath(
  groups: readonly EditorLayoutGroup[],
  path: readonly number[],
  update: (groups: readonly EditorLayoutGroup[]) => readonly EditorLayoutGroup[],
): readonly EditorLayoutGroup[] {
  if (path.length === 0) return update(groups);
  const [index, ...rest] = path;
  return groups.map((group, groupIndex) => {
    if (groupIndex !== index || !group.groups) return copyGroup(group);
    return { ...group, groups: updateGroupsAtPath(group.groups, rest, update) };
  });
}

function hasUsableEditorAreaOppositeRail(
  layout: EditorLayout | undefined,
  position: RailPosition,
): layout is EditorLayout {
  if (!hasSeparateEditorArea(layout)) {
    return false;
  }
  const railIndex = getRailRootGroupIndex(layout, position);
  return layout.groups.some((group, index) => (
    index !== railIndex
    && typeof group.size === 'number'
    && Number.isFinite(group.size)
    && group.size >= MIN_RAIL_WIDTH
  ));
}

function isPersistableRailRatio(ratio: number | undefined): boolean {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= MAX_PERSISTED_RAIL_RATIO;
}
