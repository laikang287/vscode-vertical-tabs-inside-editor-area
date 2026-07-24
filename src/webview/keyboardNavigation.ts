export type VerticalNavigationKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export function nextVerticalNavigationIndex(
  currentIndex: number,
  itemCount: number,
  key: VerticalNavigationKey,
  wrap = false,
): number {
  if (itemCount <= 0) return -1;
  const current = currentIndex >= 0 && currentIndex < itemCount ? currentIndex : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowUp') {
    if (current > 0) return current - 1;
    return wrap ? itemCount - 1 : 0;
  }
  if (current < itemCount - 1) return current + 1;
  return wrap ? 0 : itemCount - 1;
}

export function isKeyboardContextMenuKey(key: string, shiftKey: boolean): boolean {
  return key === 'ContextMenu' || (key === 'F10' && shiftKey);
}
