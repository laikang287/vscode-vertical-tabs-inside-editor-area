export const MIN_RAIL_WIDTH = 180;
export const DEFAULT_RAIL_WIDTH = 280;
export const DEFAULT_RAIL_RATIO = 0.2;
export const MIN_RAIL_RATIO = 0.1;
export const MAX_RAIL_RATIO = 0.5;
export const FULL_WIDTH_RAIL_RATIO = 0.9;
export const MAX_PERSISTED_RAIL_RATIO = 0.3;
export const VSCODE_MINIMIZED_EDITOR_GROUP_WIDTH = 220;
export const SAFE_RAIL_WIDTH = 222;

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
  if ((layout.orientation ?? 0) !== 0 || layout.groups.length === 0) {
    return undefined;
  }

  const leadingGroup = layout.groups[0];
  const leadingWidth = leadingGroup.size;
  if (typeof leadingWidth !== 'number' || !Number.isFinite(leadingWidth) || leadingWidth <= 0) {
    return undefined;
  }

  const requestedRailWidth = Math.max(minimumRailWidth, normalizeRailWidth(width));
  const railWidth = Math.min(requestedRailWidth, Math.floor(leadingWidth - minimumEditorWidth));
  if (railWidth < minimumRailWidth) {
    return undefined;
  }

  return {
    orientation: 0,
    groups: [
      { size: railWidth },
      { ...copyGroup(leadingGroup), size: leadingWidth - railWidth },
      ...layout.groups.slice(1).map(copyGroup),
    ],
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
 * Nudges only the editor group identified by `viewColumn` above VS Code's
 * native minimized width. The size is taken from the deepest horizontal split
 * that controls the target leaf's width, so nested layouts remain intact.
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
  let donorIndex: number | undefined;
  let donorSize = Number.NEGATIVE_INFINITY;
  horizontalGroups.forEach((group, index) => {
    if (index === horizontalTargetIndex || typeof group.size !== 'number' || !Number.isFinite(group.size)) return;
    if (group.size - delta < minimizedWidth) return;
    if (group.size > donorSize) {
      donorIndex = index;
      donorSize = group.size;
    }
  });
  if (donorIndex === undefined) {
    return undefined;
  }

  return {
    ...layout,
    groups: updateGroupsAtPath(layout.groups, horizontalParentPath, (siblings) => siblings.map((group, index) => {
      if (index === horizontalTargetIndex) return { ...group, size: safeWidth };
      if (index === donorIndex) return { ...group, size: donorSize - delta };
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

export function getRailGroupRatio(layout: EditorLayout): number | undefined {
  if (!hasSeparateEditorArea(layout)) {
    return undefined;
  }
  const sizes = layout.groups.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0)) {
    return undefined;
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0 ? sizes[0] / total : undefined;
}

export function shouldPersistObservedRailWidth(layout: EditorLayout | undefined, railWidth: number | undefined): boolean {
  if (!hasUsableRightEditorArea(layout)) {
    return false;
  }
  const ratio = getObservedRailRatio(layout, railWidth);
  return isPersistableRailRatio(ratio);
}

export function shouldPersistRailGroupRatio(layout: EditorLayout | undefined): boolean {
  if (!hasUsableRightEditorArea(layout)) {
    return false;
  }
  const ratio = getRailGroupRatio(layout);
  return isPersistableRailRatio(ratio);
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

function hasUsableRightEditorArea(layout: EditorLayout | undefined): layout is EditorLayout {
  if (!hasSeparateEditorArea(layout)) {
    return false;
  }
  return layout.groups.slice(1).some((group) => typeof group.size === 'number' && Number.isFinite(group.size) && group.size >= MIN_RAIL_WIDTH);
}

function isPersistableRailRatio(ratio: number | undefined): boolean {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= MAX_PERSISTED_RAIL_RATIO;
}
