import type { ChannelRefreshClaim, RefreshedTokens } from '@gani/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startWorker, type WorkerDeps } from '../worker.js';
import { createTokenRefresher } from './refresher.js';
import type { RefreshStore, TokenRefresher } from './token-refresh.js';

// The token refresh in the worker (B2-2b): it starts with the worker, and it ends before the queue and the pool close, because it uses
// the pool. The relay and the job are real; the stores, the queue and the pool are fakes that record the order.
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
const refreshSettings = {
  pollMs: 20,
  beforeSeconds: 600,
  leaseSeconds: 120,
  timeoutMs: 1_000,
  warnSeconds: 86_400,
  orgsPerTick: 10,
  orgParallel: 1,
};
const tokens: RefreshedTokens = {
  keyVersion: 1,
  accessTokenEnc: Buffer.from('access-ciphertext'),
  refreshTokenEnc: Buffer.from('refresh-ciphertext'),
  accessTokenExpiresAt: new Date(3_600_000),
  refreshTokenExpiresAt: null,
};
const noop = () => undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function worker(order: string[], refresh?: WorkerDeps['refresh']) {
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
    ...(refresh ? { refresh } : {}),
  });
}

describe('the worker with the token refresh', () => {
  it('writes the account in progress before the queue closes and the pool ends, and leaves no timer', async () => {
    const order: string[] = [];
    let release: () => void = noop;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let claimed = false;
    const store: RefreshStore = {
      dueOrgs: () => Promise.resolve(claimed ? [] : ['org-1']),
      claim: () => {
        if (claimed) return Promise.resolve(null);
        claimed = true;
        order.push('refresh.claim');
        return Promise.resolve({ id: 'account-1', claimedAt: new Date(0) } as ChannelRefreshClaim);
      },
      complete: () => (order.push('refresh.complete'), Promise.resolve(true)),
      fail: () => Promise.resolve(null),
    };
    const refresher: TokenRefresher = {
      refresh: async () => (await gate, { ok: true, tokens }),
    };
    const metrics = { refreshed: (result: string) => void order.push(`metric.${result}`) };
    const running = worker(order, { store, refresher, settings: refreshSettings, metrics });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['refresh.claim']);

    const shutdown = running.shutdown();
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual(['refresh.claim']); // the call in progress holds the job: nothing closes yet
    release();
    expect(await shutdown).toBe(true);
    expect(order).toEqual([
      'refresh.claim',
      'refresh.complete',
      'metric.ok',
      'queue.close',
      'pool.end',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has no platform client before B2-3, so main.ts gives the worker no refresh', () => {
    expect(createTokenRefresher()).toBeNull();
  });
});
