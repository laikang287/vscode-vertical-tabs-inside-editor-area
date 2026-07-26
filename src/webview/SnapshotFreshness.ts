/**
 * Tracks overlapping asynchronous refreshes so only the most recently
 * requested refresh can publish its result.
 */
export class LatestRefreshGate {
  private latestRequestId = 0;

  begin(): number {
    this.latestRequestId += 1;
    return this.latestRequestId;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.latestRequestId;
  }
}

/**
 * Equal revisions are accepted because the extension host intentionally
 * retries unacknowledged Webview messages.
 */
export function shouldAcceptSnapshotRevision(
  currentRevision: number | undefined,
  incomingRevision: number,
): boolean {
  return currentRevision === undefined || incomingRevision >= currentRevision;
}
