import { describe, expect, it, vi } from 'vitest';

import { AfterHoursReleaseJob, type ReleaseStore } from './release-job.js';

// The release job over a fake store (C10-4b): which organisations and workspaces it goes through, what it releases, what it logs, how
// it loops and stops. The store over PostgreSQL is tested in db-store.test.ts and the whole release in test/after-hours-release.spec.ts.
const SETTINGS = { pollMs: 60_000, orgsPerTick: 2, orgParallel: 1, batch: 2 };
const AT = new Date('2026-11-03T03:00:00Z');

type Fakes = { [K in keyof ReleaseStore]: ReturnType<typeof vi.fn> };
function setup(over: Partial<Fakes> = {}, settings = SETTINGS) {
  const store: Fakes = {
    heldOrgs: vi.fn(() => Promise.resolve(['o1'])),
    openWithHeld: vi.fn(() => Promise.resolve([{ workspaceId: 'w1', conversationIds: ['c1'] }])),
    release: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const job = new AfterHoursReleaseJob({
    store: store as unknown as ReleaseStore,
    log,
    settings,
    shutdownMs: 1_000,
    now: () => AT,
  });
  return { store, log, job };
}

describe('AfterHoursReleaseJob', () => {
  it('releases the held conversations of each open workspace, one by one, and logs ids and counts only', async () => {
    const t = setup({
      openWithHeld: vi.fn(() =>
        Promise.resolve([{ workspaceId: 'w1', conversationIds: ['c1', 'c2'] }]),
      ),
      release: vi.fn((_o: string, _w: string, id: string) => Promise.resolve(id === 'c1')),
    });
    expect(await t.job.tick()).toBe(true); // the batch was full: ask again at once
    expect(t.store.heldOrgs).toHaveBeenCalledWith(2);
    expect(t.store.openWithHeld).toHaveBeenCalledWith('o1', AT, 2);
    expect(t.store.release.mock.calls).toEqual([
      ['o1', 'w1', 'c1'],
      ['o1', 'w1', 'c2'],
    ]);
    expect(t.log.info).toHaveBeenCalledWith('after_hours_released', {
      orgId: 'o1',
      workspaceId: 'w1',
      released: 1,
      held: 2,
    });
  });

  it('asks again at once only when a list was full, and goes on past an organisation that fails', async () => {
    expect(await setup().job.tick()).toBe(false);
    const full = setup({ heldOrgs: vi.fn(() => Promise.resolve(['o1', 'o2'])) });
    expect(await full.job.tick()).toBe(true);
    const failing = setup({
      heldOrgs: vi.fn(() => Promise.resolve(['o1', 'o2'])),
      openWithHeld: vi.fn((orgId: string) =>
        orgId === 'o1'
          ? Promise.reject(new TypeError('x'))
          : Promise.resolve([{ workspaceId: 'w2', conversationIds: ['c9'] }]),
      ),
    });
    await failing.job.tick();
    expect(failing.log.error).toHaveBeenCalledWith('after_hours_release_org_failed', {
      orgId: 'o1',
      error: 'TypeError',
    });
    expect(failing.store.release).toHaveBeenCalledWith('o2', 'w2', 'c9');
  });

  it('loops every pollMs, survives a failed pass, and stops cleanly once (start twice is an error)', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const t = setup({
        heldOrgs: vi.fn(() => (++n === 1 ? Promise.reject(new Error('db')) : Promise.resolve([]))),
      });
      t.job.start();
      expect(() => t.job.start()).toThrow('already started');
      await vi.advanceTimersByTimeAsync(0);
      expect(t.log.error).toHaveBeenCalledWith('after_hours_release_tick_failed', {
        error: 'Error',
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(t.store.heldOrgs).toHaveBeenCalledTimes(2);
      expect(await t.job.stop()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(await setup().job.stop()).toBe(true);
  });

  it('says false and warns when the pass in progress outlasts shutdownMs', async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ heldOrgs: vi.fn(() => new Promise<string[]>(() => undefined)) });
      t.job.start();
      const stopped = t.job.stop();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await stopped).toBe(false);
      expect(t.log.warn).toHaveBeenCalledWith('after_hours_release_shutdown_timeout', {
        shutdownMs: 1_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
