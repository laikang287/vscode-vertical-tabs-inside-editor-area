export type ContextSubmenuLayout = 'right' | 'left' | 'compact';

export interface HorizontalBounds {
  readonly left: number;
  readonly right: number;
}

export function chooseContextSubmenuLayout(
  parentBounds: HorizontalBounds,
  submenuWidth: number,
  viewportWidth: number,
  compactEnabled: boolean,
  margin = 4,
): ContextSubmenuLayout {
  const rightSpace = Math.max(0, viewportWidth - margin - parentBounds.right);
  const leftSpace = Math.max(0, parentBounds.left - margin);
  if (submenuWidth <= rightSpace) return 'right';
  if (submenuWidth <= leftSpace) return 'left';
  if (compactEnabled) return 'compact';
  return rightSpace >= leftSpace ? 'right' : 'left';
}

export function clampContextMenuCoordinate(
  requested: number,
  size: number,
  viewportSize: number,
  margin = 4,
): number {
  return Math.max(margin, Math.min(requested, viewportSize - size - margin));
}

export function alignContextMenuTopToAnchor(
  anchorTop: number,
  menuHeight: number,
  viewportHeight: number,
  margin = 4,
): number {
  return clampContextMenuCoordinate(anchorTop, menuHeight, viewportHeight, margin);
}

export function shouldDismissContextMenuOnPointerDown(
  button: number,
  isInsideMenu: boolean,
): boolean {
  return button === 0 && !isInsideMenu;
}
