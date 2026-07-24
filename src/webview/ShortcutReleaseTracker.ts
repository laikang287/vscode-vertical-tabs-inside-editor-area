export interface ShortcutReleaseKeyState {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export type ShortcutReleaseResult =
  | { readonly type: 'none' }
  | { readonly type: 'complete'; readonly sessionId: string };

/**
 * Tracks the key-up half of a shortcut navigation session inside the Webview.
 * The host arms the primary key for every command invocation so key repeat and
 * repeated Tab presses keep the same session alive without committing early.
 */
export class ShortcutReleaseTracker {
  private sessionId: string | undefined;
  private primaryKey: string | undefined;
  private primaryReleased = false;

  get activeSessionId(): string | undefined {
    return this.sessionId;
  }

  arm(sessionId: string, primaryKey: string): void {
    const continuesCurrentSession = this.sessionId === sessionId && this.primaryKey === primaryKey;
    this.sessionId = sessionId;
    this.primaryKey = primaryKey;
    if (!continuesCurrentSession) {
      this.primaryReleased = false;
    }
  }

  keyDown(state: ShortcutReleaseKeyState): void {
    if (this.sessionId && state.key === this.primaryKey) {
      this.primaryReleased = false;
    }
  }

  keyUp(state: ShortcutReleaseKeyState): ShortcutReleaseResult {
    const sessionId = this.sessionId;
    if (!sessionId || !this.primaryKey) return { type: 'none' };

    if (state.key === this.primaryKey) {
      this.primaryReleased = true;
    }
    if (!this.primaryReleased || hasPressedModifier(state)) {
      return { type: 'none' };
    }

    this.clear();
    return { type: 'complete', sessionId };
  }

  cancel(sessionId?: string): string | undefined {
    if (!this.sessionId || (sessionId !== undefined && sessionId !== this.sessionId)) {
      return undefined;
    }
    const cancelledSessionId = this.sessionId;
    this.clear();
    return cancelledSessionId;
  }

  private clear(): void {
    this.sessionId = undefined;
    this.primaryKey = undefined;
    this.primaryReleased = false;
  }
}

function hasPressedModifier(state: ShortcutReleaseKeyState): boolean {
  return state.ctrlKey || state.shiftKey || state.altKey || state.metaKey;
}
