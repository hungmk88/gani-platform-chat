import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool } from '../src/index.js';
import { sqlState, url } from './db.js';

// Review A-02: the three limits of createDbPool reach PostgreSQL and do what they say. Each test uses a pool of its own with a short
// limit, so the suite does not wait for the defaults (15 s, 5 s, 30 s).
const pools: pg.Pool[] = [];
const make = (options: Parameters<typeof createDbPool>[1]) => {
  const pool = createDbPool(url('app'), { max: 2, ...options });
  pools.push(pool);
  return pool;
};
let holder: pg.Client;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// An advisory key of this spec only; the lock is taken on a separate connection and held until the transaction ends.
const KEY = 7_265_099;

beforeAll(async () => {
  holder = new pg.Client({ connectionString: url('migration') });
  await holder.connect();
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await holder.end();
});

describe('what the pool sets on a connection', () => {
  it('shows the defaults to the server', async () => {
    const pool = make({});
    const { rows } = await pool.query<Record<string, string>>(
      `SELECT current_setting('statement_timeout') AS statement,
              current_setting('lock_timeout') AS lock,
              current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    expect(rows[0]).toEqual({ statement: '15s', lock: '5s', idle: '30s' });
  });
});

describe('what each limit does', () => {
  it('cancels a statement that runs too long (57014) and leaves the pool usable', async () => {
    const pool = make({ statementTimeoutMs: 300 });
    expect(await sqlState(pool.query('SELECT pg_sleep(5)'))).toBe('57014');
    expect((await pool.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
  });

  it('stops a wait for a lock, an advisory one included (55P03)', async () => {
    const pool = make({ lockTimeoutMs: 300 });
    await holder.query('BEGIN');
    try {
      await holder.query('SELECT pg_advisory_xact_lock($1)', [KEY]);
      const waiter = await pool.connect();
      try {
        await waiter.query('BEGIN');
        const started = Date.now();
        expect(await sqlState(waiter.query('SELECT pg_advisory_xact_lock($1)', [KEY]))).toBe(
          '55P03',
        );
        expect(Date.now() - started).toBeLessThan(3_000);
      } finally {
        waiter.release(true);
      }
    } finally {
      await holder.query('ROLLBACK');
    }
  });

  it('ends a transaction that sits idle (25P03), frees its locks, and the pool recovers', async () => {
    const pool = make({ idleInTransactionTimeoutMs: 300 });
    const client = await pool.connect();
    const seen: string[] = [];
    client.on('error', (error: Error & { code?: string }) => seen.push(error.code ?? 'none'));
    // One killed connection makes `pg` emit two errors: the server's 25P03, then, when the socket closes, "Connection terminated
    // unexpectedly" with no code. Wait for `end` (it comes after both) instead of counting events at a poll tick.
    const ended = new Promise<void>((resolve) => client.once('end', () => resolve()));
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [KEY]);
    await Promise.race([ended, pause(5_000)]);
    client.release(true);
    expect(seen.filter((code) => code !== 'none')).toEqual(['25P03']);
    // The lock went with the connection: another connection takes it at once.
    await holder.query('BEGIN');
    try {
      const got = await holder.query('SELECT pg_try_advisory_xact_lock($1) AS got', [KEY]);
      expect(got.rows).toEqual([{ got: true }]);
    } finally {
      await holder.query('ROLLBACK');
    }
    expect((await pool.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
  });
});
