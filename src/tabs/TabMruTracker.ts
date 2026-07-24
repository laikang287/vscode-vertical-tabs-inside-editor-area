/**
 * Tracks successful activations by object identity.
 *
 * The clock value is made strictly increasing so multiple activations in the
 * same millisecond still have a deterministic MRU order.
 */
export class TabMruTracker<T extends object> {
  private readonly lastActivatedAtByItem = new WeakMap<T, number>();
  private lastObservedItem: T | undefined;
  private hasObservedFocus = false;
  private latestTimestamp = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  /**
   * Records only focus transitions. Passing undefined marks that focus left
   * the tracked tab set, so returning to the same item counts as new use.
   */
  observeFocused(item: T | undefined): boolean {
    if (this.hasObservedFocus && item === this.lastObservedItem) return false;
    this.hasObservedFocus = true;
    this.lastObservedItem = item;
    if (!item) return false;
    this.recordTimestamp(item);
    return true;
  }

  /** Records an activation that the caller has explicitly verified. */
  recordSuccessfulActivation(item: T): number {
    this.hasObservedFocus = true;
    this.lastObservedItem = item;
    return this.recordTimestamp(item);
  }

  lastActivatedAt(item: T): number | undefined {
    return this.lastActivatedAtByItem.get(item);
  }

  private recordTimestamp(item: T): number {
    const timestamp = Math.max(this.clock(), this.latestTimestamp + 1);
    this.latestTimestamp = timestamp;
    this.lastActivatedAtByItem.set(item, timestamp);
    return timestamp;
  }
}
