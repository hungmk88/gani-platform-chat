import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Spec RLS M01 §3.4 and §7 case 6. Connects as support_test_login (a CI-only login in support_role): the gate reads
// session_user, which SET ROLE cannot fake. One organization per situation, so the tests do not depend on each other.
const LOGIN = 'support_test_login';
const TABLES = [
  'organizations',
  'org_members',
  'workspaces',
  'workspace_members',
  'teams',
  'team_members',
  'api_keys',
  'audit_logs',
  'platform_access_logs',
];
const keyOf = (table: string) => (table === 'organizations' ? 'id' : 'org_id');
const [NONE, VALID, EXPIRED, OTHER] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const users = new Map<string, string>();
let admin: pg.Client;
let support: pg.Client;
let app: pg.Client;

// A session of 30 minutes that began `agoMin` minutes ago (the 60 minute CHECK still holds).
const openSession = (org: string, login: string, agoMin: number) =>
  admin.query(
    `INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, created_at, expires_at)
     VALUES ($1, $2, $3, $4, 'support test', now() - make_interval(mins => $5::int),
             now() - make_interval(mins => $5::int) + interval '30 minutes')`,
    [uuidv7(), org, users.get(org), login, agoMin],
  );

async function inOrg<T>(org: string, fn: () => Promise<T>): Promise<T> {
  await support.query('BEGIN');
  try {
    await support.query(
      "SELECT set_config('app.current_org', $1, true), set_config('app.current_workspaces', '{}', true)",
      [org],
    );
    return await fn();
  } finally {
    await support.query('ROLLBACK').catch(() => undefined);
  }
}
const seen = (table: string, org: string) =>
  inOrg(org, async () => {
    const { rows } = await support.query<{ k: string }>(
      `SELECT ${keyOf(table)} AS k FROM ${support.escapeIdentifier(table)}`,
    );
    return rows.map((r) => r.k);
  });
const query = (org: string, text: string) => sqlState(inOrg(org, () => support.query(text)));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  support = new pg.Client({ connectionString: url('support') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), support.connect(), app.connect()]);
  for (const org of [NONE, VALID, EXPIRED, OTHER]) users.set(org, await seedTenant(admin, org));
  await openSession(VALID, LOGIN, 0);
  await openSession(EXPIRED, LOGIN, 120);
  await openSession(OTHER, 'someone_else', 0);
});

afterAll(async () => {
  await support.end().catch(() => undefined);
  await app.end().catch(() => undefined);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end().catch(() => undefined);
});

describe('case 6: the gate', () => {
  it('no session: 0 rows in every table (each table does hold a row for the org)', async () => {
    for (const table of TABLES) {
      const own = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${admin.escapeIdentifier(table)} WHERE ${keyOf(table)} = $1`,
        [NONE],
      );
      expect(own.rows[0]?.n, table).toBeGreaterThan(0);
      expect(await seen(table, NONE), table).toEqual([]);
    }
  });

  it('an expired session, or the session of another login: 0 rows', async () => {
    for (const org of [EXPIRED, OTHER]) {
      for (const table of TABLES) expect(await seen(table, org), table).toEqual([]);
    }
  });

  it('a valid session shows that org only, in every table', async () => {
    for (const table of TABLES) {
      const rows = await seen(table, VALID);
      expect(rows.length, table).toBeGreaterThan(0);
      expect(new Set(rows), table).toEqual(new Set([VALID]));
    }
  });

  it('is read-only: INSERT, UPDATE, DELETE and TRUNCATE are denied (42501)', async () => {
    for (const table of TABLES) {
      const [t, k] = [support.escapeIdentifier(table), keyOf(table)];
      for (const text of [
        `INSERT INTO ${t} DEFAULT VALUES`,
        `UPDATE ${t} SET ${k} = ${k}`,
        `DELETE FROM ${t}`,
        `TRUNCATE ${t}`,
      ]) {
        expect(await query(VALID, text), text).toBe('42501');
      }
    }
  });
});

describe('TN001 passes through SECURITY DEFINER', () => {
  it('without a tenant context neither the function nor a table answers: both raise TN001', async () => {
    expect(await sqlState(support.query('SELECT app.support_access_ok()'))).toBe('TN001');
    expect(await sqlState(support.query('SELECT org_id FROM teams'))).toBe('TN001');
  });
});

describe('app.support_access_ok()', () => {
  it('is executable by support_role only, and is a STABLE SECURITY DEFINER with a fixed search_path', async () => {
    const { rows } = await admin.query(
      `SELECT r, has_function_privilege(r, 'app.support_access_ok()', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role']) AS r ORDER BY r`,
    );
    expect(rows).toEqual([
      { r: 'app_role', ok: false },
      { r: 'auth_role', ok: false },
      { r: 'support_role', ok: true },
    ]);
    expect(await sqlState(app.query('SELECT app.support_access_ok()'))).toBe('42501');
    const meta = await admin.query(
      `SELECT pg_get_userbyid(proowner) AS owner, prosecdef, provolatile, proconfig
       FROM pg_proc WHERE oid = 'app.support_access_ok()'::regprocedure`,
    );
    expect(meta.rows).toEqual([
      {
        owner: 'migration_role',
        prosecdef: true,
        provolatile: 's',
        proconfig: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
  });

  it('does not depend on the caller search_path, and a temp table cannot be created to shadow anything', async () => {
    for (const path of ["''", 'pg_temp, public']) {
      const ok = await inOrg(VALID, async () => {
        await support.query(`SET LOCAL search_path = ${path}`);
        return (await support.query<{ ok: boolean }>('SELECT app.support_access_ok() AS ok'))
          .rows[0]?.ok;
      });
      expect(ok, path).toBe(true);
    }
    expect(await sqlState(support.query('CREATE TEMP TABLE platform_access_logs (id int)'))).toBe(
      '42501',
    );
  });
});

describe('column-level SELECT', () => {
  it.each([
    ['invite_token_hash', 'org_members'],
    ['invite_expires_at', 'org_members'],
    ['key_hash', 'api_keys'],
  ])('%s of %s is denied (42501), as is SELECT *', async (column, table) => {
    expect(await query(VALID, `SELECT ${column} FROM ${table}`)).toBe('42501');
    expect(await query(VALID, `SELECT * FROM ${table}`)).toBe('42501');
  });

  it('org_id and invited_email are readable, and so are the visible columns of api_keys', async () => {
    expect(await query(VALID, 'SELECT org_id, invited_email FROM org_members')).toBeUndefined();
    expect(await query(VALID, 'SELECT org_id, key_prefix, scopes FROM api_keys')).toBeUndefined();
  });
});
