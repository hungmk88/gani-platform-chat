import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startWorker, type WorkerDeps } from '../worker.js';
import type { PartitionStore } from './partition-job.js';

// The partition maintenance in the worker (PM-2b): it starts with the worker, and it ends before the queue and the pool close,
// because it uses the pool. The relay and the job are real; the store, the queue and the pool are fakes that record the order.
const settings: WorkerDeps['settings'] = {
  pollMs: 20,
  leaseSeconds: 60,
  batchSize: 10,
  maxAttempts: 5,
  orgsPerTick: 5,
  orgParallel: 2,
  shutdownMs: 1_000,
  queueMaxWaiting: 100,
};
const noop = () => undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function worker(order: string[], maintenance?: PartitionStore) {
  return startWorker({
    store: {
      pendingOrgs: () => Promise.resolve([]),
      reapExpired: () => Promise.resolve(0),
      claim: () => Promise.resolve([]),
      markPublished: () => Promise.resolve(0),
      fail: () => Promise.resolve(null),
    },
    queue: {
      waiting: () => Promise.resolve(0),
      publish: () => Promise.resolve({ duplicates: [] }),
      close: () => (order.push('queue.close'), Promise.resolve()),
    },
    pool: { end: () => (order.push('pool.end'), Promise.resolve()) },
    log: { info: noop, warn: noop, error: noop },
    settings,
    ...(maintenance ? { maintenance } : {}),
  });
}

describe('the worker with the partition maintenance', () => {
  it('stops the job before the queue closes and the queue before the pool ends, and leaves no timer', async () => {
    const order: string[] = [];
    let release: () => void = noop;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store: PartitionStore = {
      ensure: async () => {
        order.push('job.ensure');
        await gate;
        order.push('job.ended');
        return [];
      },
      purgeKeys: () => Promise.resolve(0),
      defaultRows: () => Promise.resolve([]),
    };
    const running = worker(order, store);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['job.ensure']);

    const shutdown = running.shutdown();
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual(['job.ensure']); // the job still holds the pool: nothing closes yet
    release();
    expect(await shutdown).toBe(true);
    expect(order).toEqual(['job.ensure', 'job.ended', 'queue.close', 'pool.end']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs the job when the worker starts, and a worker given none still shuts down in order', async () => {
    const order: string[] = [];
    const ensured: number[] = [];
    const store: PartitionStore = {
      ensure: (months) => (ensured.push(months), Promise.resolve([])),
      purgeKeys: () => Promise.resolve(0),
      defaultRows: () => Promise.resolve([]),
    };
    const withJob = worker(order, store);
    await vi.advanceTimersByTimeAsync(0);
    expect(ensured).toEqual([3]);
    expect(await withJob.shutdown()).toBe(true);

    order.length = 0;
    const withoutJob = worker(order);
    expect(await withoutJob.shutdown()).toBe(true);
    expect(order).toEqual(['queue.close', 'pool.end']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
