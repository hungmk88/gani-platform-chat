import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url, withClient } from './db.js';

// Spec RLS M01 §7 case 1 (every RLS table) and case 11 (no DELETE anywhere), generated from the catalog:
// a table added by a later PR is covered automatically, or fails here until it has its fixture row below.
const GLOBAL_TABLES = ['users']; // no tenant key on purpose (Brief P8, spec §3.3)
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
const seedUser = uuidv7();
let admin: pg.Client;
let app: pg.Client;

// One row per RLS table, so that SELECT has a row to evaluate the policy on (N59: an empty table raises nothing).
async function seed(): Promise<void> {
  const [member, workspace, team] = [uuidv7(), uuidv7(), uuidv7()];
  // Every value is a UUID generated here, never client input.
  await admin.query(`
    INSERT INTO organizations (id, slug, name) VALUES ('${org}', 't-${org}', 'T');
    INSERT INTO users (id, email, status) VALUES ('${seedUser}', '${seedUser}@example.test', 'active');
    INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ('${member}', '${org}', '${seedUser}', 'owner', 'active');
    INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ('${workspace}', '${org}', 'ws', 'W', 'service');
    INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ('${uuidv7()}', '${org}', '${workspace}', '${seedUser}');
    INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ('${team}', '${org}', '${workspace}', 'T', 'tm');
    INSERT INTO team_members (id, org_id, team_id, user_id) VALUES ('${uuidv7()}', '${org}', '${team}', '${seedUser}')`);
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), app.connect()]);
  await seed();
});

afterAll(async () => {
  await app.end();
  const children = ['team_members', 'teams', 'workspace_members', 'workspaces', 'org_members'];
  for (const table of children) await admin.query(`DELETE FROM ${table} WHERE org_id = $1`, [org]);
  await admin.query('DELETE FROM users WHERE id = $1', [seedUser]);
  await admin.query('DELETE FROM organizations WHERE id = $1', [org]);
  await admin.end();
});

describe('every public table is either RLS-protected or explicitly global', () => {
  it('has no table without a tenant key outside the allowlist', () => {
    const untracked = tables.filter((t) => !t.tenant && !GLOBAL_TABLES.includes(t.name));
    expect(untracked.map((t) => t.name)).toEqual([]);
  });
});

describe.each(rlsTables)('%s', (table) => {
  it('has ENABLE + FORCE RLS and one policy on app_role using app.current_org() for USING and WITH CHECK', async () => {
    const cls = await admin.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
      [`public.${table}`],
    );
    expect(cls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const pol = await admin.query<{
      policyname: string;
      cmd: string;
      roles: string[];
      qual: string;
      check: string;
    }>(
      `SELECT policyname, cmd, roles::text[] AS roles, qual, with_check AS check
       FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [table],
    );
    expect(pol.rows.map(({ policyname, cmd, roles }) => ({ policyname, cmd, roles }))).toEqual([
      { policyname: `${table}_app`, cmd: 'ALL', roles: ['app_role'] },
    ]);
    expect(pol.rows[0]?.qual).toContain('current_org');
    expect(pol.rows[0]?.check).toContain('current_org');
  });

  it('case 1: SELECT without a TenantTx raises TN001 (the table has a row to evaluate)', async () => {
    const own = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${admin.escapeIdentifier(table)} WHERE ${table === 'organizations' ? 'id' : 'org_id'} = $1`,
      [org],
    );
    expect(own.rows[0]?.n, 'add a fixture row for this table in seed()').toBeGreaterThan(0);
    expect(await sqlState(app.query(`SELECT 1 FROM ${app.escapeIdentifier(table)} LIMIT 1`))).toBe(
      'TN001',
    );
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
