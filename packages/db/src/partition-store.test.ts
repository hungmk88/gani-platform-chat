import { readFileSync } from 'node:fs';

import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_ROWS_CAP, defaultPartitionRows, ensureLogPartitions } from './partition-store.js';

// The two functions only ask the database and map the answer; what the database answers is checked on PostgreSQL in
// test/partitions-ensure.spec.ts and test/partitions-default-rows.spec.ts. Here the pool is a stand-in with a `query` that is watched.
const poolAnswering = (rows: unknown[]) => {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as pg.Pool, query };
};
const poolFailing = (error: Error) => {
  const query = vi.fn().mockRejectedValue(error);
  return { pool: { query } as unknown as pg.Pool, query };
};

describe('ensureLogPartitions', () => {
  it('asks app.ensure_log_partitions with the months it was given, as a parameter', async () => {
    const { pool, query } = poolAnswering([]);
    await ensureLogPartitions(pool, 3);
    await ensureLogPartitions(pool, 12);
    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0]?.[0])).toContain('app.ensure_log_partitions($1)');
    const params = query.mock.calls.map((call: unknown[]) => call[1]);
    expect(params).toEqual([[3], [12]]);
  });

  it('maps each row: the table, how many partitions were made, and the months that were blocked', async () => {
    const { pool } = poolAnswering([
      { parent: 'audit_logs', created: 1, blocked_months: [] },
      { parent: 'messages', created: 0, blocked_months: ['2027-01', '2027-02'] },
    ]);
    expect(await ensureLogPartitions(pool, 3)).toEqual([
      { parent: 'audit_logs', created: 1, blockedMonths: [] },
      { parent: 'messages', created: 0, blockedMonths: ['2027-01', '2027-02'] },
    ]);
  });

  it('returns an empty list when there is no log table', async () => {
    const { pool } = poolAnswering([]);
    expect(await ensureLogPartitions(pool, 3)).toEqual([]);
  });

  it('passes on the error of the database, with its code, and does not swallow it', async () => {
    const failure = Object.assign(new Error('lock timeout'), { code: '55P03' });
    const { pool } = poolFailing(failure);
    await expect(ensureLogPartitions(pool, 3)).rejects.toBe(failure);
  });
});

describe('defaultPartitionRows', () => {
  it('asks app.log_default_partition_rows and needs no parameter', async () => {
    const { pool, query } = poolAnswering([]);
    await defaultPartitionRows(pool);
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain('app.log_default_partition_rows()');
    expect(query.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('maps the count, which bigint gives as text, to a number', async () => {
    const { pool } = poolAnswering([
      { parent: 'audit_logs', rows_capped: '0' },
      { parent: 'inbound_events', rows_capped: '1001' },
    ]);
    expect(await defaultPartitionRows(pool)).toEqual([
      { parent: 'audit_logs', rowsCapped: 0 },
      { parent: 'inbound_events', rowsCapped: DEFAULT_ROWS_CAP },
    ]);
  });

  it('passes on the error of the database and does not swallow it', async () => {
    const failure = new Error('connection terminated');
    const { pool } = poolFailing(failure);
    await expect(defaultPartitionRows(pool)).rejects.toBe(failure);
  });
});

describe('DEFAULT_ROWS_CAP', () => {
  it('is the number at which the SQL function stops counting: the migration says LIMIT of the same number', () => {
    const migration = readFileSync(
      new URL('../migrations/202610131000_create_log_default_partition_rows.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain(`LIMIT ${DEFAULT_ROWS_CAP})`);
    expect(DEFAULT_ROWS_CAP).toBe(1001);
  });
});
