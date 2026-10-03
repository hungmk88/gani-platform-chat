import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url, withClient } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Spec RLS M01 §7 case 1 (every RLS table) and case 11 (no DELETE anywhere), generated from the catalog:
// a table added by a later PR is covered automatically, or fails here until it has its fixture row in fixtures.ts.
// No tenant key on purpose: users (Brief P8, spec §3.3) and the migration runner's ledger.
const GLOBAL_TABLES = ['users', 'schema_migrations'];
// app_role has no privilege here on purpose (N69): case 1 is 42501, not TN001.
const NO_APP_ACCESS = ['platform_access_logs'];
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

const tables = await withClient('migration', async (c) => {
  const { rows } = await c.query<{ name: string; tenant: boolean }>(
    `SELECT c.relname AS name,
            (c.relname = 'organizations' OR EXISTS (
               SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)) AS tenant
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
     ORDER BY c.relname`,
  );
  return rows;
});
const rlsTables = tables.filter((t) => t.tenant).map((t) => t.name);

const org = uuidv7();
let seedUser = '';
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  seedUser = await seedTenant(admin, org);
});

afterAll(async () => {
  await app.end();
  await cleanupTenant(admin, org, seedUser);
  await admin.end();
});

describe('every public table is either RLS-protected or explicitly global', () => {
  it('has no table without a tenant key outside the allowlist', () => {
    const untracked = tables.filter((t) => !t.tenant && !GLOBAL_TABLES.includes(t.name));
    expect(untracked.map((t) => t.name)).toEqual([]);
  });
});

it('app_role has no privilege on a global table', async () => {
  const { rows } = await admin.query<{ t: string; p: string }>(
    `SELECT t, p FROM unnest($1::text[]) AS t, unnest($2::text[]) AS p
     WHERE has_table_privilege('app_role', 'public.' || t, p)`,
    [GLOBAL_TABLES, PRIVILEGES],
  );
  expect(rows).toEqual([]);
});

describe.each(rlsTables)('%s', (table) => {
  it('has ENABLE + FORCE RLS, an app_role policy on app.current_org() and a support_role SELECT policy behind support_access_ok()', async () => {
    const cls = await admin.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
      [`public.${table}`],
    );
    expect(cls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const { rows } = await admin.query<{
      policyname: string;
      cmd: string;
      roles: string[];
      qual: string;
      check: string | null;
    }>(
      `SELECT policyname, cmd, roles::text[] AS roles, qual, with_check AS check
       FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`,
      [table],
    );
    expect(rows.map(({ policyname, cmd, roles }) => [policyname, cmd, roles])).toEqual([
      [`${table}_app`, 'ALL', ['app_role']],
      [`${table}_support`, 'SELECT', ['support_role']],
    ]);
    const [appPolicy, supportPolicy] = rows;
    expect([appPolicy?.qual, appPolicy?.check].every((e) => e?.includes('current_org'))).toBe(true);
    expect(supportPolicy?.qual).toContain('current_org');
    expect(supportPolicy?.qual).toContain('support_access_ok');
  });

  it('gives support_role no privilege other than SELECT', async () => {
    const { rows } = await admin.query(
      `SELECT p FROM unnest($1::text[]) AS p WHERE p <> 'SELECT' AND has_table_privilege('support_role', $2, p)`,
      [PRIVILEGES, `public.${table}`],
    );
    expect(rows).toEqual([]);
  });

  it('case 1: SELECT without a TenantTx raises TN001, or 42501 where app_role has no access', async () => {
    const own = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${admin.escapeIdentifier(table)} WHERE ${table === 'organizations' ? 'id' : 'org_id'} = $1`,
      [org],
    );
    expect(own.rows[0]?.n, 'add a fixture row for this table in fixtures.ts').toBeGreaterThan(0);
    const expected = NO_APP_ACCESS.includes(table) ? '42501' : 'TN001';
    const select = app.query(`SELECT 1 FROM ${app.escapeIdentifier(table)} LIMIT 1`);
    expect(await sqlState(select)).toBe(expected);
  });

  it('case 11: app_role cannot DELETE or TRUNCATE, and auth_role has no privilege at all', async () => {
    expect(
      await sqlState(app.query(`DELETE FROM ${app.escapeIdentifier(table)} WHERE false`)),
    ).toBe('42501');
    const { rows } = await admin.query<{ role: string; priv: string; ok: boolean }>(
      `SELECT r AS role, p AS priv, has_table_privilege(r, $1, p) AS ok
       FROM unnest(ARRAY['app_role', 'auth_role']) AS r, unnest($2::text[]) AS p`,
      [`public.${table}`, PRIVILEGES],
    );
    const granted = rows.filter((r) => r.ok).map((r) => `${r.role}:${r.priv}`);
    expect(
      granted.filter(
        (g) => g.startsWith('auth_role') || /:(DELETE|TRUNCATE|REFERENCES|TRIGGER)$/.test(g),
      ),
    ).toEqual([]);
  });
});
