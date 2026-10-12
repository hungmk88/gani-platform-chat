import type { EnsuredPartitions } from '@gani/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogFields } from '../logger.js';
import {
  AFTER_FAILURE_MS,
  INBOUND_KEY_RETENTION_DAYS,
  PURGE_BATCH,
  PURGE_MAX_ROUNDS,
  PartitionMaintenanceJob,
  type PartitionStore,
} from './partition-job.js';

const NOW = new Date('2026-10-14T10:00:00Z');
const SIX = [
  'created',
  'purged_keys',
  'blocked_months_count',
  'default_rows_count',
  'consecutive_failures',
  'duration_ms',
];
const ALL_WAITS = 1_000 + 4_000 + 16_000;
type Line = { level: string; message: string; fields: LogFields };

const made = (parent: string, created = 0, blockedMonths: string[] = []): EnsuredPartitions => ({
  parent,
  created,
  blockedMonths,
});
const lock = () => Object.assign(new Error('lock timeout'), { code: '55P03' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 spreads nothing
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A job over a fake store, with its log lines. The clock is the fake timers of vitest. */
function setup(over: Partial<PartitionStore> = {}) {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (message: string, fields: LogFields = {}) =>
      void lines.push({ level, message, fields });
  const store: PartitionStore = {
    ensure: () => Promise.resolve([made('audit_logs', 1)]),
    purgeKeys: () => Promise.resolve(0),
    defaultRows: () => Promise.resolve([]),
    ...over,
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error') };
  return { job: new PartitionMaintenanceJob({ store, log }), lines };
}
/** The one line of that name. */
const only = (lines: Line[], message: string): Line | undefined => {
  const found = lines.filter((l) => l.message === message);
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0];
};
/** A whole run in which every attempt fails: the three waits pass in fake time. */
const failedRun = async (job: PartitionMaintenanceJob) => {
  const run = job.runOnce();
  await vi.advanceTimersByTimeAsync(ALL_WAITS);
  return run;
};

describe('one run', () => {
  it('makes three months, purges until nothing is left, and says it in one line', async () => {
    const answers = [PURGE_BATCH, 250, 0];
    const asked: [number, number][] = [];
    const months: number[] = [];
    const { job, lines } = setup({
      ensure: (n) => (
        months.push(n),
        Promise.resolve([made('audit_logs', 1), made('messages', 2)])
      ),
      purgeKeys: (days, limit) => (
        asked.push([days, limit]),
        Promise.resolve(answers.shift() ?? 0)
      ),
    });
    expect(await job.runOnce()).toBe(true);
    expect(months).toEqual([3]);
    expect(asked).toEqual(Array(3).fill([INBOUND_KEY_RETENTION_DAYS, PURGE_BATCH]));
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'partition_maintenance',
        fields: {
          created: 3,
          purged_keys: PURGE_BATCH + 250,
          blocked_months_count: 0,
          default_rows_count: 0,
          consecutive_failures: 0,
          duration_ms: 0,
          purge_complete: true,
        },
      },
    ]);
  });

  it('warns with the tables and the months that DEFAULT blocks', async () => {
    const { job, lines } = setup({
      ensure: () =>
        Promise.resolve([
          made('audit_logs', 0, ['2027-01']),
          made('messages', 1),
          made('outbox_events', 0, ['2027-01', '2027-02']),
        ]),
    });
    await job.runOnce();
    const line = only(lines, 'partition_blocked');
    expect(line?.level).toBe('warn');
    expect(line?.fields).toMatchObject({
      tables: 'audit_logs,outbox_events',
      months: '2027-01,2027-02',
      blocked_months_count: 3,
    });
  });

  it('warns when a DEFAULT partition holds rows: the tables that do, and only those', async () => {
    const rows = [
      { parent: 'audit_logs', rowsCapped: 3 },
      { parent: 'messages', rowsCapped: 0 },
      { parent: 'inbound_events', rowsCapped: 1001 },
    ];
    const { job, lines } = setup({ defaultRows: () => Promise.resolve(rows) });
    await job.runOnce();
    const line = only(lines, 'partition_default_rows');
    expect(line?.level).toBe('warn');
    expect(line?.fields).toMatchObject({
      tables: 'audit_logs:3,inbound_events:1001',
      default_rows_count: 1004,
    });
  });

  it('stops purging at the ceiling and says the purge is not finished', async () => {
    let rounds = 0;
    const { job, lines } = setup({ purgeKeys: () => (rounds++, Promise.resolve(PURGE_BATCH)) });
    await job.runOnce();
    const line = only(lines, 'partition_maintenance');
    expect(rounds).toBe(PURGE_MAX_ROUNDS);
    expect(line?.level).toBe('warn');
    expect(line?.fields).toMatchObject({
      purge_complete: false,
      purged_keys: PURGE_MAX_ROUNDS * PURGE_BATCH,
    });
  });
});

describe('failures', () => {
  it.each([
    [0.5, [1_000, 4_000, 16_000]],
    [0, [800, 3_200, 12_800]],
    [1, [1_200, 4_800, 19_200]],
  ])(
    'waits 1, 4 and 16 seconds (random %s: %j), and a late success counts what the first attempts made',
    async (random, waits) => {
      vi.mocked(Math.random).mockReturnValue(random);
      let attempts = 0;
      const { job, lines } = setup({
        ensure: () =>
          ++attempts < 4 ? Promise.reject(lock()) : Promise.resolve([made('audit_logs', 2)]),
      });
      const run = job.runOnce();
      let elapsed = 0;
      for (const [i, wait] of waits.entries()) {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(attempts, `before wait ${i + 1} ends`).toBe(i + 1);
        await vi.advanceTimersByTimeAsync(1);
        elapsed += wait;
      }
      expect(await run).toBe(true);
      expect(attempts).toBe(4);
      expect(lines.map((l) => l.message)).toEqual(['partition_maintenance']);
      expect(lines[0]?.fields).toMatchObject({
        created: 2,
        consecutive_failures: 0,
        duration_ms: elapsed,
      });
    },
  );

  it('counts failed runs in a row: a warning, then errors, and zero again after a good run', async () => {
    let broken = true;
    const { job, lines } = setup({
      ensure: () => (broken ? Promise.reject(lock()) : Promise.resolve([made('audit_logs')])),
    });
    expect([await failedRun(job), await failedRun(job), await failedRun(job)]).toEqual([
      false,
      false,
      false,
    ]);
    broken = false;
    expect(await job.runOnce()).toBe(true);
    expect(lines.map((l) => [l.level, l.message, l.fields['consecutive_failures']])).toEqual([
      ['warn', 'partition_maintenance_failed', 1],
      ['error', 'partition_maintenance_failed', 2],
      ['error', 'partition_maintenance_failed', 3],
      ['info', 'partition_maintenance', 0],
    ]);
    expect(lines[0]?.fields).toMatchObject({ attempts: 4, error_code: '55P03' });
  });
});

describe('the schedule and the stop', () => {
  it('runs at once and at 19:00 UTC (9 hours later), and after a failed run in an hour', async () => {
    const ensured: number[] = [];
    const good = setup({ ensure: (n) => (ensured.push(n), Promise.resolve([])) });
    good.job.start();
    await vi.advanceTimersByTimeAsync(9 * 3_600_000 - 1);
    expect(ensured).toEqual([3]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ensured).toEqual([3, 3]);
    await good.job.stop();
    expect(vi.getTimerCount()).toBe(0);

    let attempts = 0;
    const bad = setup({ ensure: () => (attempts++, Promise.reject(lock())) });
    bad.job.start();
    await vi.advanceTimersByTimeAsync(ALL_WAITS + AFTER_FAILURE_MS - 1);
    expect(attempts).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(5);
    await bad.job.stop();
    expect(() => bad.job.start()).toThrow(/already started/);
  });

  it('ends the pause of a retry, makes no other attempt, and leaves no timer behind', async () => {
    let attempts = 0;
    const { job } = setup({ ensure: () => (attempts++, Promise.reject(lock())) });
    const run = job.runOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await job.stop();
    expect(await run).toBe(false);
    expect([attempts, vi.getTimerCount()]).toEqual([1, 0]);
  });
});

describe('what the lines hold', () => {
  it('has the six numbers in every line, only plain values, and never the message of an error', async () => {
    const secret = 'Nguyen Van A 0901234567 an@example.test';
    const blocked = setup({
      ensure: () => Promise.resolve([made('audit_logs', 1, ['2027-01'])]),
      defaultRows: () => Promise.resolve([{ parent: 'messages', rowsCapped: 2 }]),
    });
    const failing = setup({
      ensure: () => Promise.reject(Object.assign(new Error(secret), { detail: secret })),
    });
    const unfinished = setup({ purgeKeys: () => Promise.resolve(PURGE_BATCH) });
    await blocked.job.runOnce();
    await failedRun(failing.job);
    await unfinished.job.runOnce();
    const all = [...blocked.lines, ...failing.lines, ...unfinished.lines];
    expect(new Set(all.map((l) => l.message))).toEqual(
      new Set([
        'partition_maintenance',
        'partition_blocked',
        'partition_default_rows',
        'partition_maintenance_failed',
      ]),
    );
    for (const line of all) {
      for (const key of SIX)
        expect(typeof line.fields[key], `${line.message} ${key}`).toBe('number');
      for (const value of Object.values(line.fields))
        expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
    expect(JSON.stringify(all)).not.toMatch(/Nguyen|0901234567|example\.test/);
    expect(only(failing.lines, 'partition_maintenance_failed')?.fields['error_code']).toBe('Error');
  });
});
