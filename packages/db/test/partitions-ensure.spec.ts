import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool } from '../src/index.js';
import { sqlState, url } from './db.js';

// app.ensure_log_partitions (PM-1, N110; spec RLS M01 §7 case 9c: the maintenance makes the next months and the new partitions pass 9a/9b).
// Most cases run inside a transaction that is rolled back, so the partitions they make do not outlive them: partitions.spec.ts case 9c
// counts the partition it makes after the three that the migrations made. The two cases that need a commit (two callers at once, and the
// call of app_role) work on a scratch table, which is dropped at the end.
//
// The set of tables below is the point of case 2: Brief P8 M07 has `ai_usage_logs`, which does not exist yet. When it does, the function
// finds it by itself and that case goes red on purpose: update the list (and the rest of the file) with the table.
const PARENTS = [
  'audit_logs',
  'conversation_events',
  'inbound_events',
  'messages',
  'outbox_events',
  'platform_access_logs',
];
const SCRATCH = 'zz_ensure_probe';
const ROLES = ['app_role', 'auth_role', 'support_role'];
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const [A] = [uuidv7()];
interface Made {
  parent: string;
  created: number;
  blocked_months: string[];
}

let admin: pg.Client;
let second: pg.Client;
let pool: pg.Pool;

const ensure = async (client: pg.Client | pg.Pool, months?: number | null): Promise<Made[]> =>
  (
    await (months === undefined
      ? client.query<Made>('SELECT * FROM app.ensure_log_partitions()')
      : client.query<Made>('SELECT * FROM app.ensure_log_partitions($1)', [months]))
  ).rows;

/** Runs `fn` in a transaction of the admin client and rolls it back: DDL included, nothing of it stays. */
async function rolledBack<T>(fn: () => Promise<T>): Promise<T> {
  await admin.query('BEGIN');
  try {
    return await fn();
  } finally {
    await admin.query('ROLLBACK');
  }
}

/** The month `offset` months from now (UTC): the suffix of the partition, the label, and a moment inside it. */
async function month(offset: number) {
  const { rows } = await admin.query<{ suffix: string; label: string; inside: Date }>(
    `WITH m AS (SELECT date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => $1) AS start)
     SELECT to_char(start, '"_y"YYYY"m"MM') AS suffix, to_char(start, 'YYYY-MM') AS label,
            (start + interval '2 days') AT TIME ZONE 'UTC' AS inside FROM m`,
    [offset],
  );
  return rows[0] as { suffix: string; label: string; inside: Date };
}

async function children(parent: string): Promise<string[]> {
  const { rows } = await admin.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = $1::regclass ORDER BY c.relname`,
    [`public.${parent}`],
  );
  return rows.map((r) => r.name);
}

const policies = (table: string) =>
  admin.query(
    `SELECT policyname, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies
     WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`,
    [table],
  );

async function expectSecure(parent: string, child: string): Promise<void> {
  const cls = await admin.query(
    'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
    [`public.${child}`],
  );
  expect(cls.rows, child).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  expect((await policies(child)).rows, child).toEqual((await policies(parent)).rows);
  const granted = await admin.query(
    `SELECT r, p FROM unnest($1::text[]) AS r, unnest($2::text[]) AS p
     WHERE has_table_privilege(r, $3::regclass, p)`,
    [ROLES, PRIVILEGES, `public.${child}`],
  );
  expect(granted.rows, child).toEqual([]);
}

/** A partitioned table of its own with only its DEFAULT partition and this month, committed; dropped when `fn` ends. */
async function withScratch<T>(fn: () => Promise<T>): Promise<T> {
  await admin.query(`DROP TABLE IF EXISTS public.${SCRATCH}`);
  await admin.query(
    `CREATE TABLE public.${SCRATCH} (id integer NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (id, created_at))
     PARTITION BY RANGE (created_at)`,
  );
  try {
    await admin.query(`SELECT app.create_log_partitions('public.${SCRATCH}', 0)`);
    return await fn();
  } finally {
    await admin.query(`DROP TABLE IF EXISTS public.${SCRATCH}`);
  }
}

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  second = new pg.Client({ connectionString: url('migration') });
  await Promise.all([admin.connect(), second.connect()]);
  await admin.query(`DROP TABLE IF EXISTS public.${SCRATCH}`);
  await admin.query("INSERT INTO organizations (id, slug, name) VALUES ($1, 't-ensure', 'E')", [A]);
});

afterAll(async () => {
  await admin.query(`DROP TABLE IF EXISTS public.${SCRATCH}`);
  await admin.query('DELETE FROM audit_logs WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM organizations WHERE id = $1', [A]);
  await pool.end();
  await Promise.all([admin.end(), second.end()]);
});

describe('app.ensure_log_partitions: the function', () => {
  it('is SECURITY DEFINER with a fixed search_path, and only app_role may run it', async () => {
    const { rows } = await admin.query<{ definer: boolean; cfg: string[]; roles: string[] }>(
      `SELECT p.prosecdef AS definer, p.proconfig AS cfg,
              (SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r
               WHERE has_function_privilege(r, p.oid, 'EXECUTE')) AS roles
       FROM pg_proc p WHERE p.oid = 'app.ensure_log_partitions(integer)'::regprocedure`,
    );
    expect(rows).toEqual([
      { definer: true, cfg: ['search_path=pg_catalog, public, pg_temp'], roles: ['app_role'] },
    ]);
  });

  it('finds exactly the log tables of this schema (the list changes when ai_usage_logs is built)', async () => {
    const made = await rolledBack(() => ensure(admin));
    expect(made.map((m) => m.parent)).toEqual(PARENTS);
  });
});

describe('app.ensure_log_partitions: the months', () => {
  it('makes this month and three more for every table, and a second call makes nothing', async () => {
    await rolledBack(async () => {
      const wanted = await Promise.all([0, 1, 2, 3].map(month));
      const before = new Map<string, number>();
      for (const parent of PARENTS) {
        const have = await children(parent);
        before.set(parent, wanted.filter((m) => !have.includes(`${parent}${m.suffix}`)).length);
      }
      const first = await ensure(admin);
      expect(first.map((m) => [m.parent, m.created, m.blocked_months])).toEqual(
        PARENTS.map((p) => [p, before.get(p), []]),
      );
      for (const parent of PARENTS)
        for (const m of wanted) expect(await children(parent)).toContain(`${parent}${m.suffix}`);
      expect((await ensure(admin)).map((m) => m.created)).toEqual(PARENTS.map(() => 0));
    });
  });

  it('sends a row of next month and of the third month to its own partition, not to DEFAULT', async () => {
    await rolledBack(async () => {
      await ensure(admin);
      for (const offset of [1, 3]) {
        const when = await month(offset);
        const id = uuidv7();
        await admin.query(
          `INSERT INTO audit_logs (id, org_id, action, detail, created_at) VALUES ($1, $2, 'probe', '{}'::jsonb, $3)`,
          [id, A, when.inside],
        );
        const { rows } = await admin.query<{ child: string }>(
          'SELECT tableoid::regclass::text AS child FROM audit_logs WHERE id = $1',
          [id],
        );
        expect(rows[0]?.child).toBe(`audit_logs${when.suffix}`);
      }
    });
  });

  it('accepts 1 and 12 months ahead, and refuses 0, 13 and NULL (22023)', async () => {
    await rolledBack(async () => {
      expect((await ensure(admin, 1)).length).toBe(PARENTS.length);
      expect((await ensure(admin, 12)).length).toBe(PARENTS.length);
    });
    for (const bad of [0, 13, null]) {
      expect(await sqlState(ensure(admin, bad)), String(bad)).toBe('22023');
    }
  });

  it('makes partitions that pass 9a and 9b: RLS in force, the policies of the parent, no grant', async () => {
    await rolledBack(async () => {
      await ensure(admin, 3);
      for (const parent of PARENTS)
        for (const child of await children(parent)) await expectSecure(parent, child);
    });
  });
});

describe('app.ensure_log_partitions: the DEFAULT partition and the callers', () => {
  it('skips a month that DEFAULT already holds rows of, says so, and still serves the others', async () => {
    await rolledBack(async () => {
      const stuck = await month(5);
      await admin.query(
        `INSERT INTO audit_logs (id, org_id, action, detail, created_at) VALUES ($1, $2, 'probe', '{}'::jsonb, $3)`,
        [uuidv7(), A, stuck.inside],
      );
      const made = await ensure(admin, 6);
      const by = new Map(made.map((m) => [m.parent, m]));
      expect(by.get('audit_logs')?.blocked_months).toEqual([stuck.label]);
      expect(await children('audit_logs')).not.toContain(`audit_logs${stuck.suffix}`);
      expect(await children('audit_logs')).toContain(`audit_logs${(await month(6)).suffix}`);
      for (const parent of PARENTS.filter((p) => p !== 'audit_logs')) {
        expect(by.get(parent)?.blocked_months, parent).toEqual([]);
        expect(await children(parent), parent).toContain(`${parent}${stuck.suffix}`);
      }
    });
  });

  it('lets two callers at once wait for each other: no error, no table made twice', async () => {
    await withScratch(async () => {
      await admin.query('BEGIN');
      await second.query('BEGIN');
      try {
        const first = await ensure(admin, 2);
        expect(first.find((m) => m.parent === SCRATCH)?.created).toBe(2);
        const waiting = ensure(second, 2);
        // The second one has to be stopped at the advisory lock before the first lets go.
        let stopped = false;
        for (let i = 0; i < 100 && !stopped; i++) {
          const { rowCount } = await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
          );
          stopped = (rowCount ?? 0) > 0;
          if (!stopped) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(stopped).toBe(true);
        await admin.query('COMMIT');
        const later = await waiting;
        await second.query('COMMIT');
        expect(later.find((m) => m.parent === SCRATCH)?.created).toBe(0);
      } finally {
        await admin.query('ROLLBACK').catch(() => undefined);
        await second.query('ROLLBACK').catch(() => undefined);
      }
      expect(await children(SCRATCH)).toHaveLength(4);
    });
  });

  it('is run by app_role itself, which cannot make a table, so the work is the definer own', async () => {
    await withScratch(async () => {
      const made = await ensure(pool, 2);
      expect(made.find((m) => m.parent === SCRATCH)).toEqual({
        parent: SCRATCH,
        created: 2,
        blocked_months: [],
      });
      expect(await children(SCRATCH)).toHaveLength(4);
    });
  });
});
