import { describe, expect, it, vi } from 'vitest';

import type { Logger } from './logger.js';
import { startWorker, type WorkerDeps } from './worker.js';

const settings: WorkerDeps['settings'] = {
  pollMs: 20,
  leaseSeconds: 60,
  batchSize: 10,
  maxAttempts: 5,
  orgsPerTick: 5,
  orgParallel: 2,
  shutdownMs: 60,
  queueMaxWaiting: 100,
};

interface Options {
  readonly queueClose?: () => Promise<void>;
  readonly poolEnd?: () => Promise<void>;
  /** Hold the first pass of the relay until `release()`. */
  readonly hold?: boolean;
}

// The relay is the real one over a store that can be held in the middle of a pass, so the order of the shutdown can be seen: the
// queue and the pool must not close while the relay is still using them.
function setup(options: Options = {}) {
  const events: string[] = [];
  const logs: string[] = [];
  let inPass = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  const pendingOrgs = vi.fn(async (): Promise<string[]> => {
    inPass++;
    try {
      if (first && options.hold !== false) await gate;
      first = false;
      return [];
    } finally {
      inPass--;
    }
  });
  const store = {
    pendingOrgs,
    reapExpired: vi.fn(),
    claim: vi.fn(),
    markPublished: vi.fn(),
    fail: vi.fn(),
  };
  const queue = {
    waiting: () => Promise.resolve(0),
    publish: () => Promise.resolve({ duplicates: [] }),
    close: vi.fn(() => {
      events.push(`queue.close (relay in a pass: ${inPass})`);
      return options.queueClose?.() ?? Promise.resolve();
    }),
  };
  const pool = {
    end: vi.fn(() => {
      events.push(`pool.end (relay in a pass: ${inPass})`);
      return options.poolEnd?.() ?? Promise.resolve();
    }),
  };
  const log: Logger = {
    info: () => undefined,
    warn: (message, fields) => void logs.push(`${message} ${JSON.stringify(fields ?? {})}`),
    error: (message, fields) => void logs.push(`${message} ${JSON.stringify(fields ?? {})}`),
  };
  const worker = startWorker({ store, queue, pool, log, settings });
  return { worker, store, queue, pool, events, logs, release, inPass: () => inPass };
}

describe('startWorker', () => {
  it('starts the relay', async () => {
    const t = setup({ hold: false });
    await vi.waitFor(() => expect(t.store.pendingOrgs).toHaveBeenCalled());
    await t.worker.shutdown();
  });

  it('closes the queue and then the pool only after the relay has finished its pass', async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.inPass()).toBe(1));
    const done = t.worker.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(t.events).toEqual([]);
    t.release();
    expect(await done).toBe(true);
    expect(t.events).toEqual(['queue.close (relay in a pass: 0)', 'pool.end (relay in a pass: 0)']);
  });

  it('goes on to the next step when one fails, says so without the message, and answers false', async () => {
    const t = setup({
      hold: false,
      queueClose: () => Promise.reject(new TypeError('redis://:secret@host')),
    });
    expect(await t.worker.shutdown()).toBe(false);
    expect(t.pool.end).toHaveBeenCalledTimes(1);
    expect(t.logs).toEqual(['shutdown_step_failed {"step":"queue","error":"TypeError"}']);
  });

  it('answers false when the pool does not close', async () => {
    const t = setup({ hold: false, poolEnd: () => Promise.reject(new Error('boom')) });
    expect(await t.worker.shutdown()).toBe(false);
  });

  it('shuts down once, however often it is called, and gives the same answer', async () => {
    const t = setup({ hold: false });
    const [a, b] = await Promise.all([t.worker.shutdown(), t.worker.shutdown()]);
    const c = await t.worker.shutdown();
    expect([a, b, c]).toEqual([true, true, true]);
    expect(t.queue.close).toHaveBeenCalledTimes(1);
    expect(t.pool.end).toHaveBeenCalledTimes(1);
  });

  it('answers false when the relay does not stop in time, and still closes the queue and the pool', async () => {
    const t = setup();
    await vi.waitFor(() => expect(t.inPass()).toBe(1));
    expect(await t.worker.shutdown()).toBe(false);
    expect(t.queue.close).toHaveBeenCalledTimes(1);
    expect(t.pool.end).toHaveBeenCalledTimes(1);
    expect(t.logs.some((line) => line.startsWith('shutdown_timeout'))).toBe(true);
    t.release();
  });

  it('answers false and does not wait for ever when the pool never closes', async () => {
    const t = setup({ hold: false, poolEnd: () => new Promise(() => undefined) });
    expect(await t.worker.shutdown()).toBe(false);
    expect(t.logs).toContain('shutdown_step_late {"step":"pool"}');
  });

  it('starts the event consumer when given, and closes its source before the queue and the pool', async () => {
    const t = setup({ hold: false });
    await t.worker.shutdown();
    const events: string[] = [];
    const source = {
      queues: vi.fn(() => Promise.resolve([])),
      subscribe: vi.fn(),
      close: vi.fn(() => Promise.resolve(void events.push('source.close'))),
    };
    const worker = startWorker({
      store: t.store,
      queue: { ...t.queue, close: () => Promise.resolve(void events.push('queue.close')) },
      pool: { end: () => Promise.resolve(void events.push('pool.end')) },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      settings: { ...settings, pollMs: 1000 },
      events: {
        source,
        handlers: {},
        settings: { enabled: true, discoveryMs: 1000, maxQueues: 1, concurrency: 1 },
      },
    });
    await vi.waitFor(() => expect(source.queues).toHaveBeenCalled());
    expect(await worker.shutdown()).toBe(true);
    expect(events).toEqual(['source.close', 'queue.close', 'pool.end']);
  });
});
