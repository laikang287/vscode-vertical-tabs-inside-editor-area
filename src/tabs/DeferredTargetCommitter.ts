export interface DeferredCommitScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface DeferredTargetCommitterCallbacks<T> {
  readonly onPreview: (target: T) => void;
  readonly onClear: () => void;
  readonly onCommit: (target: T) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

const defaultScheduler: DeferredCommitScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Keeps only the latest target during a burst and serializes committed work.
 * Cancellation invalidates commits that have not started yet, while work
 * already handed to the host is allowed to finish safely.
 */
export class DeferredTargetCommitter<T> {
  private timer: unknown | undefined;
  private target: T | undefined;
  private epoch = 0;
  private disposed = false;
  private commitQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly delayMs: number,
    private readonly callbacks: DeferredTargetCommitterCallbacks<T>,
    private readonly scheduler: DeferredCommitScheduler = defaultScheduler,
  ) {}

  get pendingTarget(): T | undefined {
    return this.target;
  }

  get hasPendingTarget(): boolean {
    return this.target !== undefined;
  }

  queue(target: T): void {
    if (this.disposed) return;
    this.target = target;
    this.callbacks.onPreview(target);
    if (this.timer !== undefined) {
      this.scheduler.clear(this.timer);
    }
    this.timer = this.scheduler.set(() => this.commitPendingTarget(), this.delayMs);
  }

  cancel(): void {
    if (this.disposed) return;
    this.epoch += 1;
    this.clearPendingTarget();
  }

  dispose(): void {
    if (this.disposed) return;
    this.epoch += 1;
    this.clearPendingTarget();
    this.disposed = true;
  }

  waitForIdle(): Promise<void> {
    return this.commitQueue;
  }

  private commitPendingTarget(): void {
    const target = this.target;
    if (target === undefined || this.disposed) return;

    const epoch = this.epoch;
    this.target = undefined;
    this.timer = undefined;
    this.callbacks.onClear();

    const commit = async () => {
      if (this.disposed || epoch !== this.epoch) return;
      await this.callbacks.onCommit(target);
    };
    this.commitQueue = this.commitQueue
      .then(commit, commit)
      .catch((error) => this.callbacks.onError(error));
  }

  private clearPendingTarget(): void {
    const hadTarget = this.target !== undefined;
    if (this.timer !== undefined) {
      this.scheduler.clear(this.timer);
      this.timer = undefined;
    }
    this.target = undefined;
    if (hadTarget) {
      this.callbacks.onClear();
    }
  }
}
