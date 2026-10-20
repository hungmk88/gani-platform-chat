import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';

// Spec RLS M01 §3.5: app.memberships_for_user, called by auth_role right after login (no tenant context).
// One person (X) in five organisations: active, suspended, deleted membership, deleted organisation, and a pending invitation.
const [OA, OB, OC, OD, OE] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const orgs = [OA, OB, OC, OD, OE];
const X = uuidv7();
// Review DB-01: Y has an active membership in OA but their users row is soft-deleted; Z owns the sessions of the revoke trigger.
const [Y, Z] = [uuidv7(), uuidv7()];
let admin: pg.Client;
let auth: pg.Client;
let app: pg.Client;
let support: pg.Client;

const member = (
  org: string,
  status: string,
  opts: { deleted?: boolean; user?: string | null } = {},
) =>
  admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, deleted_at, invited_email, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, $3, 'sales', $4, $5, $6, $7, $8)`,
    [
      uuidv7(),
      org,
      opts.user === undefined ? X : opts.user,
      status,
      opts.deleted ? new Date() : null,
      status === 'pending' ? 'pending@example.test' : null,
      status === 'pending' ? randomBytes(32) : null,
      status === 'pending' ? new Date(Date.now() + 86_400_000) : null,
    ],
  );
const memberships = (user: string) =>
  auth.query<{ org_id: string; role: string; status: string }>(
    'SELECT * FROM app.memberships_for_user($1)',
    [user],
  );

beforeAll(async () => {
  [admin, auth, app, support] = [
    new pg.Client({ connectionString: url('migration') }),
    new pg.Client({ connectionString: url('auth') }),
    new pg.Client({ connectionString: url('app') }),
    new pg.Client({ connectionString: url('support') }),
  ];
  await Promise.all([admin.connect(), auth.connect(), app.connect(), support.connect()]);
  for (const user of [X, Y, Z]) {
    await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
      user,
      `${user}@example.test`,
    ]);
  }
  for (const org of orgs) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      org,
      `t-${org}`,
      'T',
    ]);
  }
  await member(OA, 'active');
  await member(OB, 'suspended');
  await member(OC, 'active', { deleted: true });
  await member(OD, 'active');
  await admin.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [OD]);
  await member(OE, 'pending', { user: null });
  await member(OA, 'active', { user: Y });
  await admin.query('UPDATE users SET deleted_at = now() WHERE id = $1', [Y]);
});

afterAll(async () => {
  await Promise.all([auth.end(), app.end(), support.end()]);
  const steps: [string, unknown[]][] = [
    ['DELETE FROM org_members WHERE org_id = ANY($1::uuid[])', [orgs]],
    ['DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgs]],
    ['DELETE FROM sessions WHERE user_id = $1', [Z]],
    ['DELETE FROM users WHERE id = ANY($1::uuid[])', [[X, Y, Z]]],
  ];
  for (const [text, values] of steps) await admin.query(text, values).catch(() => undefined);
  await admin.end();
});

describe('app.memberships_for_user', () => {
  it('works for auth_role with no tenant context and returns active and suspended memberships, ordered by org', async () => {
    const { rows } = await memberships(X);
    expect(rows).toEqual([
      { org_id: OA, role: 'sales', status: 'active' },
      { org_id: OB, role: 'sales', status: 'suspended' },
    ]);
  });

  it('leaves out a deleted membership, a deleted organisation and a pending invitation', async () => {
    const seen = (await memberships(X)).rows.map((r) => r.org_id);
    for (const org of [OC, OD, OE]) expect(seen).not.toContain(org);
  });

  it('returns nothing for an unknown user', async () => {
    expect((await memberships(uuidv7())).rows).toEqual([]);
  });

  it('returns nothing for a soft-deleted user, even with an active membership (review DB-01)', async () => {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM org_members WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [Y],
    );
    expect(rows).toEqual([{ n: 1 }]);
    expect((await memberships(Y)).rows).toEqual([]);
  });

  it('is callable by auth_role only: app_role and support_role get 42501', async () => {
    expect(await sqlState(app.query('SELECT * FROM app.memberships_for_user($1)', [X]))).toBe(
      '42501',
    );
    expect(await sqlState(support.query('SELECT * FROM app.memberships_for_user($1)', [X]))).toBe(
      '42501',
    );
    const { rows } = await admin.query<{ role: string; ok: boolean }>(
      `SELECT r AS role, has_function_privilege(r, 'app.memberships_for_user(uuid)', 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'support_role', 'auth_role']) AS r ORDER BY r`,
    );
    expect(rows).toEqual([
      { role: 'app_role', ok: false },
      { role: 'auth_role', ok: true },
      { role: 'support_role', ok: false },
    ]);
  });

  it('is a STABLE SECURITY DEFINER owned by migration_role with a fixed search_path', async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, provolatile, proowner::regrole::text AS owner, proconfig
       FROM pg_proc WHERE oid = 'app.memberships_for_user(uuid)'::regprocedure`,
    );
    expect(rows).toEqual([
      {
        prosecdef: true,
        provolatile: 's',
        owner: 'migration_role',
        proconfig: ['search_path=pg_catalog, public, pg_temp'],
      },
    ]);
  });

  it('gives auth_role no other way in: no org_members, no other app function, no org_users', async () => {
    expect(await sqlState(auth.query('SELECT 1 FROM public.org_members'))).toBe('42501');
    expect(await sqlState(auth.query('SELECT app.current_org()'))).toBe('42501');
    expect(await sqlState(auth.query('SELECT app.support_access_ok()'))).toBe('42501');
    expect(await sqlState(auth.query('SELECT 1 FROM app.org_users'))).toBe('42501');
  });
});

// Review DB-01: soft-deleting a person revokes their live sessions in the same statement (trigger users_deleted_revoke_sessions).
describe('trigger users_deleted_revoke_sessions', () => {
  const EARLIER = new Date(Date.now() - 3_600_000);
  const session = (revokedAt: Date | null) =>
    admin.query(
      `INSERT INTO sessions (id, user_id, token, expires_at, revoked_at) VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
      [uuidv7(), Z, randomBytes(24).toString('hex'), revokedAt],
    );
  const revoked = async () =>
    (
      await admin.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM sessions WHERE user_id = $1 ORDER BY id',
        [Z],
      )
    ).rows.map((r) => r.revoked_at?.getTime() ?? null);

  it('revokes every live session of a person when they are soft-deleted, and leaves an older revocation as it was', async () => {
    await session(null);
    await session(null);
    await session(EARLIER);
    expect(await revoked()).toEqual([null, null, EARLIER.getTime()]);
    await admin.query('UPDATE users SET deleted_at = now() WHERE id = $1', [Z]);
    const after = await revoked();
    expect(after[0]).not.toBeNull();
    expect(after[1]).toBe(after[0]);
    expect(after[2]).toBe(EARLIER.getTime());
  });

  it('does nothing on a restore or on another update of the row', async () => {
    await admin.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [Z]);
    await session(null);
    await admin.query('UPDATE users SET display_name = $2 WHERE id = $1', [Z, 'Z']);
    expect((await revoked()).filter((t) => t === null)).toHaveLength(1);
  });

  it('is an INVOKER function with a fixed search_path, callable by nobody else', async () => {
    const { rows } = await admin.query(
      `SELECT prosecdef, proconfig, proowner::regrole::text AS owner,
              has_function_privilege('app_role', oid, 'EXECUTE') AS app,
              has_function_privilege('auth_role', oid, 'EXECUTE') AS auth
       FROM pg_proc WHERE oid = 'app.users_deleted_revoke_sessions()'::regprocedure`,
    );
    expect(rows).toEqual([
      {
        prosecdef: false,
        proconfig: ['search_path=pg_catalog, pg_temp'],
        owner: 'migration_role',
        app: false,
        auth: false,
      },
    ]);
  });
});
