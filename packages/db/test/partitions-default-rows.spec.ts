import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_ROWS_CAP,
  createDbPool,
  defaultPartitionRows,
  ensureLogPartitions,
} from '../src/index.js';
import { url } from './db.js';

// app.log_default_partition_rows (PM-2a, N110): the rows each log table holds in its DEFAULT partition, capped, for the maintenance
// job to warn about. The rows of these cases are written inside a transaction that is rolled back: nothing stays in a DEFAULT.
//
// The set of tables is the point of case 2, as in partitions-ensure.spec.ts: when Brief P8 M07 `ai_usage_logs` exists, the function finds
// it by itself and that case goes red on purpose. Update the list with the table.
const PARENTS = [
  'audit_logs',
  'bot_session_steps',
  'conversation_events',
  'inbound_events',
  'messages',
  'outbox_events',
  'platform_access_logs',
];
const A = uuidv7();
let admin: pg.Client;
let pool: pg.Pool;

type Counts = Record<string, number>;
const counts = async (client: pg.Client = admin): Promise<Counts> => {
  const { rows } = await client.query<{ parent: string; rows_capped: string }>(
    'SELECT parent, rows_capped FROM app.log_default_partition_rows()',
  );
  return Object.fromEntries(rows.map((r) => [r.parent, Number(r.rows_capped)]));
};

async function rolledBack<T>(fn: () => Promise<T>): Promise<T> {
  await admin.query('BEGIN');
  try {
    return await fn();
  } finally {
    await admin.query('ROLLBACK');
  }
}

/** `n` audit rows dated before every partition, so they fall into DEFAULT. */
const intoDefault = (n: number) =>
  admin.query(
    `INSERT INTO audit_logs (id, org_id, action, detail, created_at)
     SELECT gen_random_uuid(), $1, 'probe', '{}'::jsonb, timestamptz '2020-01-15 10:00:00+00' FROM generate_series(1, $2)`,
    [A, n],
  );

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  await admin.query("INSERT INTO organizations (id, slug, name) VALUES ($1, 't-default', 'D')", [
    A,
  ]);
});

afterAll(async () => {
  await admin.query('DELETE FROM audit_logs WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM organizations WHERE id = $1', [A]);
  await pool.end();
  await admin.end();
});

describe('app.log_default_partition_rows', () => {
  it('is SECURITY DEFINER with a fixed search_path, and only app_role may run it', async () => {
    const { rows } = await admin.query<{ definer: boolean; cfg: string[]; roles: string[] }>(
      `SELECT p.prosecdef AS definer, p.proconfig AS cfg,
              (SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r
               WHERE has_function_privilege(r, p.oid, 'EXECUTE')) AS roles
       FROM pg_proc p WHERE p.oid = 'app.log_default_partition_rows()'::regprocedure`,
    );
    expect(rows).toEqual([
      { definer: true, cfg: ['search_path=pg_catalog, public, pg_temp'], roles: ['app_role'] },
    ]);
  });

  it('names exactly the log tables of this schema (the list changes when ai_usage_logs is built)', async () => {
    expect(Object.keys(await counts()).sort()).toEqual(PARENTS);
  });

  it('counts the rows of a DEFAULT partition, and only those of its own table', async () => {
    await rolledBack(async () => {
      const before = await counts();
      await intoDefault(3);
      const after = await counts();
      expect(after['audit_logs']).toBe((before['audit_logs'] ?? 0) + 3);
      for (const parent of PARENTS.filter((p) => p !== 'audit_logs'))
        expect(after[parent], parent).toBe(before[parent]);
    });
  });

  it('stops counting at the cap, so a large DEFAULT is never scanned whole', async () => {
    await rolledBack(async () => {
      await intoDefault(DEFAULT_ROWS_CAP + 100);
      expect((await counts())['audit_logs']).toBe(DEFAULT_ROWS_CAP);
    });
  });
});

describe('the store of the maintenance, as app_role through a pool', () => {
  it('reads the DEFAULT rows of the six tables without a tenant and without a table of its own', async () => {
    const rows = await defaultPartitionRows(pool);
    expect(rows.map((r) => r.parent).sort()).toEqual(PARENTS);
    for (const row of rows) expect(row.rowsCapped).toBeGreaterThanOrEqual(0);
  });

  it('asks for the months through ensure_log_partitions and maps the answer (nothing is blocked)', async () => {
    const made = await ensureLogPartitions(pool, 2);
    expect(made.map((m) => m.parent).sort()).toEqual(PARENTS);
    for (const m of made) {
      expect(m.created, m.parent).toBeGreaterThanOrEqual(0);
      expect(m.blockedMonths, m.parent).toEqual([]);
    }
  });
});
