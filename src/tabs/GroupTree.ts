import type { ManualTabGroup, VerticalTabDisplayGroup } from '../webview/messages';

export const MAX_MANUAL_GROUP_DEPTH = 3;

export function normalizeManualGroups(groups: readonly ManualTabGroup[]): ManualTabGroup[] {
  const unique: ManualTabGroup[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    unique.push({
      id: group.id,
      name: group.name,
      collapsed: group.collapsed,
      ...(group.parentId ? { parentId: group.parentId } : {}),
    });
  }

  const known = new Set(unique.map((group) => group.id));
  const normalized = unique.map((group) =>
    group.parentId && group.parentId !== group.id && known.has(group.parentId)
      ? group
      : withoutParent(group));

  for (let index = 0; index < normalized.length; index += 1) {
    const group = normalized[index]!;
    const lineage = new Set([group.id]);
    let parentId = group.parentId;
    let depth = 1;
    while (parentId) {
      if (lineage.has(parentId)) {
        normalized[index] = withoutParent(group);
        break;
      }
      lineage.add(parentId);
      const parent = normalized.find((candidate) => candidate.id === parentId);
      if (!parent) {
        normalized[index] = withoutParent(group);
        break;
      }
      depth += 1;
      if (depth > MAX_MANUAL_GROUP_DEPTH) {
        normalized[index] = withoutParent(group);
        break;
      }
      parentId = parent.parentId;
    }
  }
  return normalized;
}

export function manualGroupDepth(groups: readonly ManualTabGroup[], groupId: string): number | undefined {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  let current = byId.get(groupId);
  let depth = 0;
  while (current) {
    if (seen.has(current.id)) return undefined;
    seen.add(current.id);
    depth += 1;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return depth || undefined;
}

export function manualGroupDescendantIds(groups: readonly ManualTabGroup[], groupId: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [groupId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const group of groups) {
      if (group.parentId !== parentId || descendants.has(group.id)) continue;
      descendants.add(group.id);
      queue.push(group.id);
    }
  }
  return descendants;
}

export function canMoveManualGroup(
  groups: readonly ManualTabGroup[],
  groupId: string,
  parentId: string | undefined,
  beforeGroupId?: string,
): boolean {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return false;
  if (parentId === groupId) return false;
  const descendants = manualGroupDescendantIds(groups, groupId);
  if (parentId && descendants.has(parentId)) return false;
  if (parentId && !groups.some((candidate) => candidate.id === parentId)) return false;
  if (beforeGroupId) {
    const before = groups.find((candidate) => candidate.id === beforeGroupId);
    if (!before || before.id === groupId || before.parentId !== parentId) return false;
  }
  const parentDepth = parentId ? manualGroupDepth(groups, parentId) : 0;
  if (parentDepth === undefined) return false;
  return parentDepth + manualSubtreeHeight(groups, groupId) <= MAX_MANUAL_GROUP_DEPTH;
}

export function moveManualGroup(
  groups: readonly ManualTabGroup[],
  groupId: string,
  parentId: string | undefined,
  beforeGroupId?: string,
): ManualTabGroup[] {
  if (!canMoveManualGroup(groups, groupId, parentId, beforeGroupId)) return [...groups];
  const moved = groups.find((group) => group.id === groupId)!;
  const remaining = groups.filter((group) => group.id !== groupId);
  const updated = parentId ? { ...moved, parentId } : withoutParent(moved);
  const beforeIndex = beforeGroupId
    ? remaining.findIndex((group) => group.id === beforeGroupId)
    : -1;
  if (beforeIndex >= 0) {
    remaining.splice(beforeIndex, 0, updated);
    return remaining;
  }
  const siblingIndexes = remaining
    .map((group, index) => group.parentId === parentId ? index : -1)
    .filter((index) => index >= 0);
  const insertionIndex = siblingIndexes.length > 0 ? siblingIndexes[siblingIndexes.length - 1]! + 1 : remaining.length;
  remaining.splice(insertionIndex, 0, updated);
  return remaining;
}

export function displayGroupDescendantIds(groups: readonly VerticalTabDisplayGroup[], groupId: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [groupId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const group of groups) {
      if (group.parentId !== parentId || descendants.has(group.id)) continue;
      descendants.add(group.id);
      queue.push(group.id);
    }
  }
  return descendants;
}

function manualSubtreeHeight(groups: readonly ManualTabGroup[], groupId: string): number {
  const children = groups.filter((group) => group.parentId === groupId);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((child) => manualSubtreeHeight(groups, child.id)));
}

function withoutParent(group: ManualTabGroup): ManualTabGroup {
  const { parentId: _parentId, ...rest } = group;
  return rest;
}
