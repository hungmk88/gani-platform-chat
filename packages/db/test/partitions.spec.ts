import { uuidv7 } from '@gani/domain';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, createDbPool, withTenant } from '../src/index.js';
import { sqlState, url } from './db.js';

// Spec RLS M01 §6 and §7 cases 9a-9d for audit_logs and platform_access_logs, plus the table rules (N67, N69).
const PARENTS = [
  'audit_logs',
  'platform_access_logs',
  'messages',
  'conversation_events',
  'outbox_events',
  'inbound_events',
];
const ROLES = ['app_role', 'auth_role', 'support_role'];
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const MONTHLY = /_y\d{4}m\d{2}$/;
const [A, B] = [uuidv7(), uuidv7()];
let admin: pg.Client;
let app: pg.Client;
let pool: pg.Pool;

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

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  await admin.query(
    "INSERT INTO organizations (id, slug, name) VALUES ($1, 't-a', 'A'), ($2, 't-b', 'B')",
    [A, B],
  );
});

afterAll(async () => {
  await pool.end();
  await app.end();
  for (const table of PARENTS)
    await admin.query(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [[A, B]]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B]]);
  await admin.end();
});

describe.each(PARENTS)('%s partitions', (parent) => {
  it('9a: every partition, the DEFAULT one included, has RLS and the policies of the parent', async () => {
    const all = await children(parent);
    expect(all).toContain(`${parent}_default`);
    expect(all.filter((c) => MONTHLY.test(c)).length).toBeGreaterThanOrEqual(3);
    for (const child of all) await expectSecure(parent, child);
  });

  it('9b: app_role querying a partition directly is denied (42501)', async () => {
    for (const child of await children(parent)) {
      expect(await sqlState(app.query(`SELECT 1 FROM ${app.escapeIdentifier(child)}`)), child).toBe(
        '42501',
      );
    }
  });

  it('9c: a partition created later passes 9a and 9b, and creating twice is harmless', async () => {
    try {
      await admin.query('BEGIN');
      const make = () =>
        admin.query<{ n: number }>('SELECT app.create_log_partitions($1::regclass, 12) AS n', [
          `public.${parent}`,
        ]);
      // What the call has to make: the DEFAULT partition and this month plus 12 more (the most the function takes), named as
      // app.create_log_partitions names them, minus those that exist already. Not a fixed 1: a database migrated in an earlier month,
      // or one the partition job has run on (3 months ahead), already has some (review TEST-01). 12 months ahead leaves some to make,
      // so the test cannot pass with nothing created.
      const { rows } = await admin.query<{ missing: number }>(
        `SELECT count(*) FILTER (WHERE to_regclass(name) IS NULL)::int AS missing FROM (
           SELECT format('public.%I', $1 || '_default') AS name
           UNION ALL
           SELECT format('public.%I', $1 || to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i), '"_y"YYYY"m"MM'))
           FROM generate_series(0, 12) AS i) AS wanted`,
        [parent],
      );
      const missing = rows[0]?.missing;
      expect(missing).toBeGreaterThan(0);
      const [first, again] = [await make(), await make()];
      expect([first.rows[0]?.n, again.rows[0]?.n]).toEqual([missing, 0]);
      expect((await children(parent)).filter((c) => MONTHLY.test(c)).length).toBeGreaterThanOrEqual(
        13,
      );
      for (const child of await children(parent)) await expectSecure(parent, child);
    } finally {
      await admin.query('ROLLBACK').catch(() => undefined);
    }
  });
});

const addLog = (
  org: string,
  over: { id?: string; action?: string; detail?: string; at?: string } = {},
) =>
  admin.query(
    `INSERT INTO audit_logs (id, org_id, action, detail, created_at)
     VALUES ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, now()))`,
    [over.id ?? uuidv7(), org, over.action ?? 'probe', over.detail ?? '{}', over.at ?? null],
  );
const partitionOf = async (id: string) =>
  (
    await admin.query<{ child: string }>(
      'SELECT tableoid::regclass::text AS child FROM audit_logs WHERE id = $1',
      [id],
    )
  ).rows[0]?.child ?? '';

describe('9d: a mistaken GRANT on a partition still leaves RLS in force', () => {
  it('without a TenantTx it raises TN001; with org A it shows only org A', async () => {
    const mine = uuidv7();
    await addLog(A, { id: mine });
    await addLog(B);
    const child = app.escapeIdentifier(await partitionOf(mine));
    try {
      await admin.query(`GRANT SELECT ON ${child} TO app_role`);
      expect(await sqlState(app.query(`SELECT 1 FROM ${child}`))).toBe('TN001');
      await app.query('BEGIN');
      await app.query(
        "SELECT set_config('app.current_org', $1, true), set_config('app.current_workspaces', '{}', true)",
        [A],
      );
      const seen = await app.query<{ org_id: string }>(`SELECT org_id FROM ${child}`);
      expect(seen.rows.length).toBeGreaterThan(0);
      expect(new Set(seen.rows.map((r) => r.org_id))).toEqual(new Set([A]));
    } finally {
      await app.query('ROLLBACK').catch(() => undefined);
      await admin.query(`REVOKE ALL ON ${child} FROM app_role`).catch(() => undefined);
    }
  });
});

describe('audit_logs', () => {
  const tx = (org: string) => ({ orgId: org, workspaceIds: [] });

  it('is append-only for app_role, and a tenant can write only its own org', async () => {
    const row = { id: uuidv7(), orgId: A, action: 'created' };
    await withTenant(pool, tx(A), (t) => t.insert(auditLogs).values(row));
    expect(await sqlState(app.query("UPDATE audit_logs SET action = 'y'"))).toBe('42501');
    expect(await sqlState(app.query('DELETE FROM audit_logs WHERE false'))).toBe('42501');
    expect(await sqlState(app.query('TRUNCATE audit_logs'))).toBe('42501');
  });

  it('routes a row to the monthly partition of its date, an old date to DEFAULT', async () => {
    const [now, old] = [uuidv7(), uuidv7()];
    await addLog(A, { id: now });
    await addLog(A, { id: old, at: '2020-01-01Z' });
    expect(await partitionOf(now)).toMatch(MONTHLY);
    expect(await partitionOf(old)).toBe('audit_logs_default');
  });

  it('rejects a blank action and a detail that is not an object (23514)', async () => {
    expect(await sqlState(addLog(A, { action: ' ' }))).toBe('23514');
    expect(await sqlState(addLog(A, { detail: '[]' }))).toBe('23514');
  });
});

describe('platform_access_logs (N69)', () => {
  const session = (over: { reason?: string; expires?: string } = {}) =>
    admin.query(
      `INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, created_at, expires_at)
       VALUES ($1, $2, $3, 'support_x', $4, '2026-10-01T00:00:00Z', $5::timestamptz)`,
      [uuidv7(), A, A, over.reason ?? 'ticket', over.expires ?? '2026-10-01T00:30:00Z'],
    );

  it('gives app_role no privilege and no way in, even inside a TenantTx', async () => {
    const granted = await admin.query(
      `SELECT p FROM unnest($1::text[]) AS p WHERE has_table_privilege('app_role', 'public.platform_access_logs', p)`,
      [PRIVILEGES],
    );
    expect(granted.rows).toEqual([]);
    const read = withTenant(pool, { orgId: A, workspaceIds: [] }, (t) =>
      t.execute(sql`SELECT 1 FROM platform_access_logs`),
    );
    expect(await sqlState(read)).toBe('42501');
  });

  it('accepts a 60 minute session and rejects the rest (23514)', async () => {
    await session({ expires: '2026-10-01T01:00:00Z' });
    for (const over of [
      { expires: '2026-10-01T01:00:01Z' },
      { expires: '2026-10-01T00:00:00Z' },
      { reason: ' ' },
    ]) {
      expect(await sqlState(session(over)), JSON.stringify(over)).toBe('23514');
    }
  });
});

describe('partition functions', () => {
  it('can be executed by no application role', async () => {
    const { rows } = await admin.query(
      `SELECT f, r FROM unnest(ARRAY['app.create_log_partitions(regclass,integer)', 'app.secure_log_partition(regclass,regclass)']) AS f,
              unnest($1::text[]) AS r WHERE has_function_privilege(r, f, 'EXECUTE')`,
      [ROLES],
    );
    expect(rows).toEqual([]);
  });
});

describe('moved from PR 4a (N70)', () => {
  it('audit_logs has the actor and target indexes on the parent and on a partition', async () => {
    const count = async (table: string, names: string[]) =>
      (
        await admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = $1 AND indexname = ANY($2::text[])',
          [table, names],
        )
      ).rows[0]?.n;
    expect(await count('audit_logs', ['audit_logs_actor_idx', 'audit_logs_target_idx'])).toBe(2);
    const [monthly] = (await children('audit_logs')).filter((c) => MONTHLY.test(c));
    const all = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = $1',
      [monthly],
    );
    expect(all.rows[0]?.n).toBe(4);
  });

  it('the partition function refuses a table that is not partitioned and months_ahead outside 0-12 (P0001)', async () => {
    expect(await sqlState(admin.query("SELECT app.create_log_partitions('public.teams', 1)"))).toBe(
      'P0001',
    );
    expect(
      await sqlState(admin.query("SELECT app.create_log_partitions('public.audit_logs', 13)")),
    ).toBe('P0001');
    expect(
      await sqlState(admin.query("SELECT app.create_log_partitions('public.audit_logs', -1)")),
    ).toBe('P0001');
  });

  it('a tenant cannot insert an audit_logs row for another org (42501)', async () => {
    const row = { id: uuidv7(), orgId: B, action: 'forged' };
    const insert = withTenant(pool, { orgId: A, workspaceIds: [] }, (t) =>
      t.insert(auditLogs).values(row),
    );
    expect(await sqlState(insert)).toBe('42501');
  });
});
