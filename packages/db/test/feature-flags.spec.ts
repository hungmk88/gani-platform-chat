import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, flagKeyOf, seedTenant } from './fixtures.js';

// PR 4c (N74): the constraints of the three new tables and the access of app_role and support_role to the global flags.
// Constraints are checked as migration_role (BYPASSRLS, constraints still apply); isolation of the two RLS tables comes from
// rls-all-tables.spec.ts and support-access.spec.ts, which are generated from the catalog, and for a write of agent_settings
// into another organisation from the cases at the end of this file.
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;

const flagSql = (key: string, owner = "'o'", removeBy = 'current_date') =>
  `INSERT INTO feature_flags_global (key, description, owner, remove_by) VALUES ('${key}', 'd', ${owner}, ${removeBy})`;
const override = (org: string, workspace: string | null, key: string) =>
  admin.query(
    'INSERT INTO feature_flags_overrides (id, org_id, workspace_id, flag_key, enabled) VALUES ($1, $2, $3, $4, true)',
    [uuidv7(), org, workspace, key],
  );
const setting = (org: string, user: string, max: number) =>
  admin.query(
    'INSERT INTO agent_settings (id, org_id, user_id, max_concurrent_conversations) VALUES ($1, $2, $3, $4)',
    [uuidv7(), org, user, max],
  );

beforeAll(async () => {
  [admin, app, support] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
  ];
  await Promise.all([admin.connect(), app.connect(), support.connect()]);
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
});

afterAll(async () => {
  await Promise.all([app.end(), support.end()]);
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('feature_flags_global', () => {
  it('requires a lower snake case key of 3 to 64 characters', async () => {
    for (const key of ['Bad_Key', 'bad-key', '1abc', 'ab', `a${'b'.repeat(64)}`]) {
      expect(await sqlState(admin.query(flagSql(key))), key).toBe('23514');
    }
  });

  it('requires an owner and a remove_by date', async () => {
    expect(await sqlState(admin.query(flagSql('no_owner', "''")))).toBe('23514');
    expect(await sqlState(admin.query(flagSql('no_owner', 'NULL')))).toBe('23502');
    expect(await sqlState(admin.query(flagSql('no_date', "'o'", 'NULL')))).toBe('23502');
  });

  it('is readable by app_role without a tenant context, but not writable by it', async () => {
    const { rows } = await app.query('SELECT key FROM feature_flags_global WHERE key = $1', [
      flagKeyOf(A),
    ]);
    expect(rows).toHaveLength(1);
    expect(await sqlState(app.query(flagSql('app_writes')))).toBe('42501');
    expect(await sqlState(app.query("UPDATE feature_flags_global SET owner = 'x'"))).toBe('42501');
  });

  it('is readable by support_role without an access-session, and read-only for it', async () => {
    const { rows } = await support.query('SELECT key FROM feature_flags_global WHERE key = $1', [
      flagKeyOf(A),
    ]);
    expect(rows).toHaveLength(1);
    expect(await sqlState(support.query(flagSql('support_writes')))).toBe('42501');
  });
});

describe('feature_flags_overrides', () => {
  it('keeps a single organisation-wide override per flag, and a single one per workspace', async () => {
    await override(A, null, flagKeyOf(B));
    expect(await sqlState(override(A, null, flagKeyOf(B)))).toBe('23505');
    const workspace = (
      await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A])
    ).rows[0]?.id as string;
    await override(A, workspace, flagKeyOf(B));
    expect(await sqlState(override(A, workspace, flagKeyOf(B)))).toBe('23505');
  });

  it('rejects an unknown flag, and a workspace of another organisation', async () => {
    expect(await sqlState(override(A, null, 'no_such_flag'))).toBe('23503');
    const other = (
      await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [B])
    ).rows[0]?.id as string;
    expect(await sqlState(override(A, other, flagKeyOf(A)))).toBe('23503');
  });

  it('keeps a flag that an override still points to (RESTRICT)', async () => {
    expect(
      await sqlState(
        admin.query('DELETE FROM feature_flags_global WHERE key = $1', [flagKeyOf(A)]),
      ),
    ).toBe('23503');
  });

  it('refuses app_role an override for another organisation (42501)', async () => {
    await app.query('BEGIN');
    try {
      await app.query(
        "SELECT set_config('app.current_org', $1, true), set_config('app.current_workspaces', '{}', true)",
        [A],
      );
      const insert = app.query(
        'INSERT INTO feature_flags_overrides (id, org_id, flag_key, enabled) VALUES ($1, $2, $3, true)',
        [uuidv7(), B, flagKeyOf(B)],
      );
      expect(await sqlState(insert)).toBe('42501');
    } finally {
      await app.query('ROLLBACK');
    }
  });
});

describe('agent_settings', () => {
  it('requires max_concurrent_conversations above 0 and sets no upper bound', async () => {
    expect(await sqlState(setting(A, users.get(A) as string, 0))).toBe('23514');
    expect(await sqlState(setting(A, users.get(A) as string, -1))).toBe('23514');
    await admin.query('DELETE FROM agent_settings WHERE org_id = $1', [A]);
    await setting(A, users.get(A) as string, 1_000_000);
  });

  it('allows one row per (org, user)', async () => {
    expect(await sqlState(setting(A, users.get(A) as string, 5))).toBe('23505');
  });

  it('rejects a user who is not a member of that organisation', async () => {
    expect(await sqlState(setting(A, users.get(B) as string, 5))).toBe('23503');
  });
});

// agent_settings_app in SQL of A's own, as app_role; the read across organisations is case 2 of rls-all-tables.spec.ts.
describe('agent_settings_app: A writes no setting of B', () => {
  const theirs = () =>
    admin.query(
      'SELECT id, max_concurrent_conversations AS max FROM agent_settings WHERE org_id = $1',
      [B],
    );

  it('writes no setting for B: 42501 (WITH CHECK)', async () => {
    const sql = 'INSERT INTO agent_settings (id, org_id, user_id) VALUES ($1, $2, $3)';
    const insert = asApp(app, A, [], () => app.query(sql, [uuidv7(), B, users.get(B)]));
    expect(await sqlState(insert)).toBe('42501');
  });

  it('changes no setting of B: 0 rows (USING), committed, and B keeps its limit', async () => {
    const before = await theirs();
    expect(before.rows, 'B must hold its seed setting, or 0 rows proves nothing').toHaveLength(1);
    const sql =
      'UPDATE agent_settings SET max_concurrent_conversations = max_concurrent_conversations + 1';
    await app.query('BEGIN');
    // COMMIT ends a failed transaction too (as a rollback), so the client is free for afterAll either way.
    const update = app
      .query("SELECT set_config('app.current_org', $1, true)", [A])
      .then(() => app.query(`${sql} WHERE org_id = $1`, [B]))
      .finally(() => app.query('COMMIT'));
    expect((await update).rowCount).toBe(0);
    expect((await theirs()).rows).toEqual(before.rows);
  });
});
