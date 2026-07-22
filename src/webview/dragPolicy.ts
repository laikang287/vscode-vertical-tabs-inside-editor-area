import type { GroupMode, SortMode } from './messages';

export type TabDragCapability = 'disabled' | 'moveGroup' | 'reorder' | 'moveDirectory' | 'moveDirectoryAndReorder';

export function tabDragCapability(groupMode: GroupMode, sortMode: SortMode): TabDragCapability {
  if (groupMode === 'parentDir') return sortMode === 'none' ? 'moveDirectoryAndReorder' : 'moveDirectory';
  if (groupMode === 'fileType') return sortMode === 'none' ? 'reorder' : 'disabled';
  return sortMode === 'none' ? 'reorder' : 'moveGroup';
}

export function canReorderTabs(capability: TabDragCapability): boolean {
  return capability === 'reorder' || capability === 'moveDirectoryAndReorder';
}

export function canMoveFilesBetweenDirectories(capability: TabDragCapability): boolean {
  return capability === 'moveDirectory' || capability === 'moveDirectoryAndReorder';
}
