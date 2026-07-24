export type TabCommandDirection = -1 | 1;

/** Returns the adjacent index with wraparound, or -1 when the list is empty. */
export function adjacentCyclicIndex(length: number, currentIndex: number, direction: TabCommandDirection): number {
  if (length <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= length) return direction < 0 ? length - 1 : 0;
  return (currentIndex + direction + length) % length;
}

/**
 * Moves every selected item one position while preserving the selected items'
 * relative order. Adjacent selected items move as one block.
 */
export function moveItemsOneStep<T>(
  order: readonly T[],
  selectedItems: readonly T[],
  direction: TabCommandDirection,
): T[] {
  const result = [...order];
  const selected = new Set(selectedItems);
  if (direction < 0) {
    for (let index = 1; index < result.length; index += 1) {
      if (selected.has(result[index]!) && !selected.has(result[index - 1]!)) {
        [result[index - 1], result[index]] = [result[index]!, result[index - 1]!];
      }
    }
    return result;
  }

  for (let index = result.length - 2; index >= 0; index -= 1) {
    if (selected.has(result[index]!) && !selected.has(result[index + 1]!)) {
      [result[index], result[index + 1]] = [result[index + 1]!, result[index]!];
    }
  }
  return result;
}
