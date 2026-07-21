export const MIN_RAIL_WIDTH = 180;
export const DEFAULT_RAIL_WIDTH = 280;
export const DEFAULT_RAIL_RATIO = 0.2;
export const MIN_RAIL_RATIO = 0.1;
export const MAX_RAIL_RATIO = 0.5;
export const FULL_WIDTH_RAIL_RATIO = 0.9;
export const MAX_PERSISTED_RAIL_RATIO = 0.3;

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

function hasUsableRightEditorArea(layout: EditorLayout | undefined): layout is EditorLayout {
  if (!hasSeparateEditorArea(layout)) {
    return false;
  }
  return layout.groups.slice(1).some((group) => typeof group.size === 'number' && Number.isFinite(group.size) && group.size >= MIN_RAIL_WIDTH);
}

function isPersistableRailRatio(ratio: number | undefined): boolean {
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= MAX_PERSISTED_RAIL_RATIO;
}
