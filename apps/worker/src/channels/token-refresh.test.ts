import type { ChannelRefreshClaim, ChannelRefreshKey, RefreshedTokens } from '@gani/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logger.js';
import {
  ChannelTokenRefreshJob,
  type RefreshFailure,
  type RefreshOutcome,
  type RefreshStore,
} from './token-refresh.js';

const settings = {
  pollMs: 20,
  beforeSeconds: 600,
  leaseSeconds: 120,
  timeoutMs: 1_000,
  warnSeconds: 86_400,
  orgsPerTick: 10,
  orgParallel: 2,
};
const tokens: RefreshedTokens = {
  keyVersion: 1,
  accessTokenEnc: Buffer.from('new-access-ciphertext'),
  refreshTokenEnc: Buffer.from('new-refresh-ciphertext'),
  accessTokenExpiresAt: new Date(3_600_000),
  refreshTokenExpiresAt: null,
};
const ok = (): Promise<RefreshOutcome> => Promise.resolve({ ok: true, tokens });

afterEach(() => vi.useRealTimers());

// A store with the rules of B2-1b: an account is claimed once (a stamp), its result is written only under that stamp, and a failed
// account is not handed out again in the pass. `steal` plays another job that took the claim back meanwhile.
function setup(
  ids: string[],
  answer: (claim: ChannelRefreshClaim, signal: AbortSignal) => Promise<RefreshOutcome>,
) {
  let clock = 0;
  const rows = new Map(ids.map((id) => [id, { stamp: 0, done: false }]));
  const written: string[] = [];
  const failures: (RefreshFailure & { id: string })[] = [];
  const logs: string[] = [];
  const holds = (key: ChannelRefreshKey) => rows.get(key.id)?.stamp === key.claimedAt.getTime();
  const store: RefreshStore = {
    dueOrgs: () => Promise.resolve([...rows.values()].some((r) => !r.done) ? ['org'] : []),
    claim: (orgId) => {
      if (orgId === 'broken') return Promise.reject(new Error('down'));
      const [id, row] = [...rows].find(([, r]) => !r.done && r.stamp === 0) ?? [];
      if (!id || !row) return Promise.resolve(null);
      row.stamp = ++clock;
      return Promise.resolve({ id, claimedAt: new Date(row.stamp) } as ChannelRefreshClaim);
    },
    complete: (_org, key) => {
      if (!holds(key)) return Promise.resolve(false);
      Object.assign(rows.get(key.id) ?? {}, { stamp: 0, done: true });
      written.push(key.id);
      return Promise.resolve(true);
    },
    fail: (_org, key, failure) => {
      if (!holds(key)) return Promise.resolve(null);
      Object.assign(rows.get(key.id) ?? {}, { done: true });
      failures.push({ id: key.id, ...failure });
      return Promise.resolve(failure.disconnect ? 'disconnected' : 'connected');
    },
  };
  const line = (message: string, fields?: object) =>
    void logs.push(`${message} ${JSON.stringify(fields ?? {})}`);
  const log: Logger = { info: line, warn: line, error: line };
  const metrics = { refreshed: vi.fn() };
  const job = new ChannelTokenRefreshJob({
    store,
    refresher: { refresh: answer },
    log,
    settings,
    shutdownMs: 200,
    metrics,
  });
  const steal = (id: string) => Object.assign(rows.get(id) ?? {}, { stamp: ++clock });
  return { job, store, written, failures, logs, metrics, steal };
}

describe('ChannelTokenRefreshJob.tick', () => {
  it('claims one account at a time and writes its tokens under its claim, logging ids only', async () => {
    const t = setup(['a', 'b'], ok);
    expect(await t.job.tick()).toBe(false);
    expect(t.written).toEqual(['a', 'b']);
    expect(t.metrics.refreshed.mock.calls).toEqual([['ok'], ['ok']]);
    expect(t.logs[0]).toBe('channel_token_refreshed {"orgId":"org","channelAccountId":"a"}');
    expect(t.logs.join()).not.toContain('ciphertext');
  });

  it('writes nothing when its claim was taken back during the call, and only logs it', async () => {
    const t = setup(['a'], () => (t.steal('a'), ok()));
    await t.job.tick();
    expect(t.written).toEqual([]);
    expect(t.logs).toEqual(['channel_refresh_lease_lost {"orgId":"org","channelAccountId":"a"}']);
    expect(t.metrics.refreshed).toHaveBeenCalledWith('lease_lost');
  });

  it('cuts a call that hangs at timeoutMs: E_TOKEN_TIMEOUT, kept for the next try, its signal aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const t = setup(['a'], (_claim, s) => ((signal = s), new Promise<never>(() => undefined)));
    const pass = t.job.tick();
    await vi.advanceTimersByTimeAsync(settings.timeoutMs);
    expect(t.failures).toEqual([
      { id: 'a', errorCode: 'E_TOKEN_TIMEOUT', disconnect: false, warnSeconds: 86_400 },
    ]);
    expect(signal?.aborted).toBe(true);
    await pass;
  });

  it('disconnects an account whose token the platform refuses, and keeps a transient failure for the next try', async () => {
    const t = setup(['a', 'b'], (claim) =>
      Promise.resolve(
        claim.id === 'a'
          ? { ok: false, code: 'E_TOKEN_REFUSED', refused: true }
          : { ok: false, code: 'E_TOKEN_NETWORK', refused: false },
      ),
    );
    await t.job.tick();
    expect(t.failures.map((f) => [f.id, f.errorCode, f.disconnect])).toEqual([
      ['a', 'E_TOKEN_REFUSED', true],
      ['b', 'E_TOKEN_NETWORK', false],
    ]);
    expect(t.metrics.refreshed.mock.calls).toEqual([['refused'], ['failed']]);
    expect(t.logs[0]).toMatch(/^channel_disconnected /);
  });

  it('turns a throw or a text that is not a code into E_TOKEN_CLIENT, and goes on past an organisation that fails', async () => {
    const t = setup(['a', 'b'], (claim) =>
      claim.id === 'a'
        ? Promise.reject(new Error('token xyz'))
        : Promise.resolve({ ok: false, code: 'bad text', refused: false }),
    );
    t.store.dueOrgs = () => Promise.resolve(['broken', 'org']);
    await t.job.tick();
    expect(t.failures.map((f) => f.errorCode)).toEqual(['E_TOKEN_CLIENT', 'E_TOKEN_CLIENT']);
    expect(t.logs[0]).toBe('channel_refresh_org_failed {"orgId":"broken","error":"Error"}');
    expect(t.logs.join()).not.toMatch(/xyz|bad text/);
  });
});

describe('ChannelTokenRefreshJob.start and stop', () => {
  it('passes until stopped, waking the pause; false when the pass in progress outlives shutdownMs', async () => {
    vi.useFakeTimers();
    const t = setup(['a'], ok);
    t.job.start();
    expect(() => t.job.start()).toThrow();
    await vi.advanceTimersByTimeAsync(settings.pollMs * 3);
    expect(t.written).toEqual(['a']);
    expect(await t.job.stop()).toBe(true);

    const stuck = setup(['a'], () => new Promise<never>(() => undefined));
    stuck.store.dueOrgs = () => new Promise<never>(() => undefined);
    stuck.job.start();
    const stopped = stuck.job.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(await stopped).toBe(false);
    expect(stuck.logs).toEqual(['channel_refresh_shutdown_timeout {"shutdownMs":200}']);
  });
});
