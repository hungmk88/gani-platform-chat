import { describe, expect, it, vi } from 'vitest';

import { SlaHoursJob, type SlaHoursStore } from './sla-hours-job.js';

// The SLA job of the opening hours over a fake store (E4b, N211): what it goes through and moves, what it logs and counts, the lag
// and the stall it reports (CEO 07/11/2026, 2.2 and 2.3), how it loops and stops. The store over PostgreSQL is in db-store.test.ts.
const SETTINGS = { pollMs: 60_000, orgsPerTick: 2, orgParallel: 1, batch: 2 };
const MIN = 60_000;

type Fakes = { [K in keyof SlaHoursStore]: ReturnType<typeof vi.fn> };
function setup(over: Partial<Fakes> = {}) {
  let at = new Date('2026-11-03T10:30:00Z');
  const store: Fakes = {
    runningOrgs: vi.fn(() => Promise.resolve(['o1'])),
    toMove: vi.fn(() => Promise.resolve([{ workspaceId: 'w1', conversationIds: ['c1'] }])),
    move: vi.fn(() => Promise.resolve(true)),
    ...over,
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const metrics = { slaHoursPass: vi.fn(), slaHoursLagHigh: vi.fn() };
  const job = new SlaHoursJob({
    store: store as unknown as SlaHoursStore,
    log,
    settings: SETTINGS,
    shutdownMs: 1_000,
    metrics,
    now: () => at,
  });
  const later = (ms: number) => (at = new Date(at.getTime() + ms));
  return { store, log, metrics, job, later, at: () => at };
}

describe('SlaHoursJob', () => {
  it('moves the SLAs of each workspace at the time of the pass, one by one, and logs and counts ids and numbers only', async () => {
    const t = setup({
      toMove: vi.fn(() => Promise.resolve([{ workspaceId: 'w1', conversationIds: ['c1', 'c2'] }])),
      move: vi.fn((_o: string, _w: string, id: string) => Promise.resolve(id === 'c1')),
    });
    expect(await t.job.tick()).toBe(true); // the batch was full: ask again at once
    expect(t.store.runningOrgs).toHaveBeenCalledWith(2);
    expect(t.store.toMove).toHaveBeenCalledWith('o1', t.at(), 2);
    expect(t.store.move.mock.calls).toEqual([
      ['o1', 'w1', 'c1', t.at()],
      ['o1', 'w1', 'c2', t.at()],
    ]);
    expect(t.log.info).toHaveBeenCalledWith('sla_hours_moved', {
      orgId: 'o1',
      workspaceId: 'w1',
      moved: 1,
      listed: 2,
    });
    expect(t.metrics.slaHoursPass).toHaveBeenCalledWith(1);
  });

  it('asks again at once only when a list was full, and goes on past an organisation that fails', async () => {
    expect(await setup().job.tick()).toBe(false);
    expect(
      await setup({ runningOrgs: vi.fn(() => Promise.resolve(['o1', 'o2'])) }).job.tick(),
    ).toBe(true);
    const failing = setup({
      runningOrgs: vi.fn(() => Promise.resolve(['o1', 'o2'])),
      toMove: vi.fn((orgId: string) =>
        orgId === 'o1'
          ? Promise.reject(new TypeError('x'))
          : Promise.resolve([{ workspaceId: 'w2', conversationIds: ['c9'] }]),
      ),
    });
    await failing.job.tick();
    expect(failing.log.error).toHaveBeenCalledWith('sla_hours_org_failed', {
      orgId: 'o1',
      error: 'TypeError',
    });
    expect(failing.store.move).toHaveBeenCalledWith('o2', 'w2', 'c9', failing.at());
  });

  it('reports a lag past 2 minutes only the third time in a row, and starts counting again after a pass on time', async () => {
    const t = setup({ runningOrgs: vi.fn(() => Promise.resolve([])) });
    await t.job.tick();
    for (const gap of [3, 3]) {
      t.later(gap * MIN);
      await t.job.tick();
    }
    expect(t.log.warn).not.toHaveBeenCalled();
    t.later(3 * MIN);
    await t.job.tick();
    expect(t.log.warn).toHaveBeenCalledWith('sla_job_lag_high', { lagSeconds: 180, times: 3 });
    expect(t.metrics.slaHoursLagHigh).toHaveBeenCalledTimes(1);
    t.later(MIN);
    await t.job.tick();
    t.later(3 * MIN);
    await t.job.tick();
    expect(t.log.warn).toHaveBeenCalledTimes(1);
  });

  it('says it is stalled once after 5 minutes of failed passes, and nothing more until a good one', async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ runningOrgs: vi.fn(() => Promise.reject(new TypeError('db'))) });
      t.job.start();
      for (let i = 0; i < 7; i++) {
        t.later(MIN);
        await vi.advanceTimersByTimeAsync(SETTINGS.pollMs);
      }
      const stalls = t.log.error.mock.calls.filter(([m]) => m === 'sla_job_stalled');
      expect(stalls).toEqual([['sla_job_stalled', { sinceSeconds: 300 }]]);
      expect(t.log.error).toHaveBeenCalledWith('sla_hours_tick_failed', { error: 'TypeError' });
      expect(await t.job.stop()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops after the conversation in progress and refuses a second start', async () => {
    const t = setup();
    t.job.start();
    expect(() => t.job.start()).toThrow('already started');
    expect(await t.job.stop()).toBe(true);
    expect(await setup().job.stop()).toBe(true);
  });
});
