import type { TabTarget } from './messages';

/**
 * Tracks the focused tab occurrence without treating snapshot revisions or
 * tab-order changes as navigation.
 */
export class ActiveTabFollowTracker {
  private hasObservedTarget = false;
  private previousEnabled = false;
  private previousTargetKey: string | undefined;

  shouldFollow(target: TabTarget | undefined, enabled: boolean): boolean {
    const targetKey = target ? activeTabLocationKey(target) : undefined;
    const shouldFollow = enabled
      && target !== undefined
      && (!this.hasObservedTarget || !this.previousEnabled || targetKey !== this.previousTargetKey);

    this.hasObservedTarget = true;
    this.previousEnabled = enabled;
    this.previousTargetKey = targetKey;
    return shouldFollow;
  }
}

export function activeTabLocationKey(target: TabTarget): string {
  return JSON.stringify([target.groupIndex, target.identity]);
}
