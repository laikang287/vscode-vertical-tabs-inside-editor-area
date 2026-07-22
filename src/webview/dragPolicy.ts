import type { GroupMode, SortMode } from './messages';

export type TabDragCapability = 'disabled' | 'moveGroup' | 'reorder';

export function tabDragCapability(groupMode: GroupMode, sortMode: SortMode): TabDragCapability {
  if (groupMode === 'parentDir' || groupMode === 'fileType') return 'disabled';
  return sortMode === 'none' ? 'reorder' : 'moveGroup';
}
