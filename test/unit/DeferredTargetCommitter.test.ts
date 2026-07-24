import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeferredTargetCommitter,
  type DeferredCommitScheduler,
} from '../../src/tabs/DeferredTargetCommitter';

test('commits only the latest target after the quiet period', async () => {
  const scheduler = new TestScheduler();
  const previews: string[] = [];
  const commits: string[] = [];
  let clears = 0;
  const committer = new DeferredTargetCommitter(160, {
    onPreview: (target: string) => previews.push(target),
    onClear: () => { clears += 1; },
    onCommit: async (target: string) => { commits.push(target); },
    onError: (error) => assert.fail(String(error)),
  }, scheduler);

  committer.queue('one');
  committer.queue('two');
  committer.queue('three');

  assert.deepEqual(previews, ['one', 'two', 'three']);
  assert.deepEqual(commits, []);
  assert.equal(scheduler.pendingCount, 1);
  assert.deepEqual(scheduler.delays, [160, 160, 160]);

  scheduler.runNext();
  await committer.waitForIdle();

  assert.deepEqual(commits, ['three']);
  assert.equal(clears, 1);
  assert.equal(committer.pendingTarget, undefined);
});

test('cancellation clears the preview and prevents a pending commit', async () => {
  const scheduler = new TestScheduler();
  const commits: string[] = [];
  let clears = 0;
  const committer = new DeferredTargetCommitter(160, {
    onPreview: () => undefined,
    onClear: () => { clears += 1; },
    onCommit: async (target: string) => { commits.push(target); },
    onError: (error) => assert.fail(String(error)),
  }, scheduler);

  committer.queue('target');
  committer.cancel();
  scheduler.runAll();
  await committer.waitForIdle();

  assert.deepEqual(commits, []);
  assert.equal(clears, 1);
  assert.equal(scheduler.pendingCount, 0);
});

test('serializes slow commits and keeps later targets queued', async () => {
  const scheduler = new TestScheduler();
  const started: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const committer = new DeferredTargetCommitter(160, {
    onPreview: () => undefined,
    onClear: () => undefined,
    onCommit: async (target: string) => {
      started.push(target);
      if (target === 'first') await firstGate;
    },
    onError: (error) => assert.fail(String(error)),
  }, scheduler);

  committer.queue('first');
  scheduler.runNext();
  await Promise.resolve();
  assert.deepEqual(started, ['first']);

  committer.queue('second');
  scheduler.runNext();
  await Promise.resolve();
  assert.deepEqual(started, ['first']);

  releaseFirst?.();
  await committer.waitForIdle();
  assert.deepEqual(started, ['first', 'second']);
});

class TestScheduler implements DeferredCommitScheduler {
  readonly delays: number[] = [];
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  get pendingCount(): number {
    return this.callbacks.size;
  }

  set(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.delays.push(delayMs);
    this.callbacks.set(handle, callback);
    return handle;
  }

  clear(handle: unknown): void {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  runNext(): void {
    const entry = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!entry) return;
    this.callbacks.delete(entry[0]);
    entry[1]();
  }

  runAll(): void {
    while (this.callbacks.size > 0) this.runNext();
  }
}
