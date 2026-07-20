export const MIN_RAIL_WIDTH = 180;
export const DEFAULT_RAIL_WIDTH = 280;

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
