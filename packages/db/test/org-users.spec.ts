import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Spec RLS M01 §3.3 and §7 cases 13-15. The view runs as its owner and bypasses RLS, so these tests are the only wall:
// they must show that nothing but the active people of the current organisation comes out.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const extraUsers: string[] = [];
let admin: pg.Client;
let app: pg.Client;
let support: pg.Client;

async function addMember(
  org: string,
  opts: { userDeleted?: boolean; memberDeleted?: boolean; status?: string },
) {
  const id = uuidv7();
  const pending = opts.status === 'pending';
  if (!pending) {
    extraUsers.push(id);
    await admin.query(
      `INSERT INTO users (id, email, status, display_name, deleted_at) VALUES ($1, $2, 'active', 'N', $3)`,
      [id, `${id}@example.test`, opts.userDeleted ? new Date() : null],
    );
  }
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, deleted_at, invited_email, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, $3, 'sales', $4, $5, $6, $7, $8)`,
    [
      uuidv7(),
      org,
      pending ? null : id,
      opts.status ?? 'active',
      opts.memberDeleted ? new Date() : null,
      pending ? `${id}@example.test` : null,
      pending ? randomBytes(32) : null,
      pending ? new Date(Date.now() + 86_400_000) : null,
    ],
  );
  return id;
}

/** Runs `fn` in a transaction of app_role with org `org` as its context (the view needs no workspaces); always rolled back. */
async function asApp<T>(org: string | null, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (org) await app.query("SELECT set_config('app.current_org', $1, true)", [org]);
    return await fn();
  } finally {
    await app.query('ROLLBACK').catch(() => undefined);
  }
}
const visible = async (org: string) =>
  (
    await asApp(org, () => app.query<{ user_id: string }>('SELECT user_id FROM app.org_users'))
  ).rows.map((r) => r.user_id);

let active = '';
const hidden: string[] = [];

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  support = new pg.Client({ connectionString: url('support') });
  await Promise.all([admin.connect(), app.connect(), support.connect()]);
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  active = await addMember(A, {});
  hidden.push(
    await addMember(A, { userDeleted: true }),
    await addMember(A, { memberDeleted: true }),
    await addMember(A, { status: 'suspended' }),
    await addMember(A, { status: 'pending' }),
  );
});

afterAll(async () => {
  await Promise.all([app.end(), support.end()]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [extraUsers])
    .catch(() => undefined);
  await admin.end();
});

describe('app.org_users', () => {
  it('case 13: shows the active people of the current org and nobody from another org', async () => {
    expect(new Set(await visible(A))).toEqual(new Set([seedUsers.get(A), active]));
    expect(await visible(B)).toEqual([seedUsers.get(B)]);
  });

  it('case 14: hides a deleted user, a deleted member, a suspended member and a pending invitation', async () => {
    const seen = await visible(A);
    for (const id of hidden) expect(seen).not.toContain(id);
  });

  it('case 15: without a tenant context it raises TN001', async () => {
    expect(await sqlState(app.query('SELECT 1 FROM app.org_users'))).toBe('TN001');
    expect(await sqlState(asApp(null, () => app.query('SELECT 1 FROM app.org_users')))).toBe(
      'TN001',
    );
  });

  it('exposes no email and no other column than the six of the spec', async () => {
    const res = await asApp(A, () => app.query('SELECT * FROM app.org_users'));
    expect(res.fields.map((f) => f.name)).toEqual([
      'org_id',
      'user_id',
      'display_name',
      'locale',
      'role',
      'status',
    ]);
    expect(await sqlState(asApp(A, () => app.query('SELECT email FROM app.org_users')))).toBe(
      '42703',
    );
  });

  it('gives app_role no INSERT and no UPDATE privilege on the view', async () => {
    const { rows } = await admin.query<{ can_insert: boolean; can_update: boolean }>(
      `SELECT has_table_privilege('app_role', 'app.org_users', 'INSERT') AS can_insert,
              has_table_privilege('app_role', 'app.org_users', 'UPDATE') AS can_update`,
    );
    expect(rows).toEqual([{ can_insert: false, can_update: false }]);
  });

  // The view joins two tables, so it is not auto-updatable: PostgreSQL refuses with 55000 before it looks at privileges.
  it('rejects INSERT and UPDATE on the view (55000: not updatable)', async () => {
    const insert = () => app.query('INSERT INTO app.org_users DEFAULT VALUES');
    const update = () => app.query('UPDATE app.org_users SET role = role');
    expect(await sqlState(asApp(A, insert))).toBe('55000');
    expect(await sqlState(asApp(A, update))).toBe('55000');
  });

  it('is closed to support_role, and app_role still cannot read users directly', async () => {
    expect(await sqlState(app.query('SELECT 1 FROM public.users'))).toBe('42501');
    expect(await sqlState(support.query('SELECT 1 FROM app.org_users'))).toBe('42501');
  });

  it('is owned by migration_role and is a security barrier: the isolation depends on both', async () => {
    const { rows } = await admin.query<{ owner: string; options: string[] | null }>(
      `SELECT c.relowner::regrole::text AS owner, c.reloptions AS options FROM pg_class c WHERE c.oid = 'app.org_users'::regclass`,
    );
    expect(rows[0]?.owner).toBe('migration_role');
    expect(rows[0]?.options).toContain('security_barrier=true');
  });
});
