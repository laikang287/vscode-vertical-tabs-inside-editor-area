export type DragInsertionEdge = 'before' | 'after';

export function dragInsertionEdge(clientY: number, top: number, height: number): DragInsertionEdge {
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const midpoint = top + safeHeight / 2;
  return clientY < midpoint ? 'before' : 'after';
}
