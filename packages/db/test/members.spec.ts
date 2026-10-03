import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, orgMembers, users, withTenant, type TenantTx } from '../src/index.js';
import { sqlState, url, withClient } from './db.js';

// Spec RLS M01 §7 cases 1, 2, 4, 7 (N3). Orgs A and B hold the rows the RLS tests count; C and D are free.
const [A, B, C, D] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const orgs = [A, B, C, D];
const userIds: string[] = [];
const [M1, M2] = [uuidv7(), uuidv7()];
let pool: pg.Pool;
let admin: pg.Client; // migration_role: BYPASSRLS, the only role that may write users

const ctx = (orgId: string) => ({ orgId, workspaceIds: [] });
const memberIds = (tx: TenantTx) => tx.select({ id: orgMembers.id }).from(orgMembers);

async function newUser(status: 'active' | 'pending_password' = 'active'): Promise<string> {
  const id = uuidv7();
  userIds.push(id);
  await admin.query(
    'INSERT INTO users (id, email, status, pending_password_since) VALUES ($1, $2, $3, $4)',
    [id, `${id}@example.test`, status, status === 'pending_password' ? new Date() : null],
  );
  return id;
}

interface Member {
  org: string;
  user?: string | null;
  status?: 'pending' | 'active' | 'suspended';
  role?: string;
  by?: string | null;
  email?: string | null;
  hash?: Buffer | null;
  expires?: Date | null;
}
const addMember = (m: Member, id = uuidv7()) =>
  admin.query(
    `INSERT INTO org_members (id, org_id, user_id, invited_email, role, status, invite_token_hash, invite_expires_at, invited_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      m.org,
      m.user ?? null,
      m.email ?? null,
      m.role ?? 'viewer',
      m.status ?? 'active',
      m.hash ?? null,
      m.expires ?? null,
      m.by ?? null,
    ],
  );
const invitation = (org: string, email: string, over: Partial<Member> = {}): Member => ({
  org,
  status: 'pending',
  email,
  hash: randomBytes(32),
  expires: new Date(Date.now() + 86_400_000),
  ...over,
});

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  for (const id of orgs) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      `t-${id}`,
      'Test',
    ]);
  }
  const [u1, u2] = [await newUser(), await newUser()];
  await addMember({ org: A, user: u1, role: 'owner' }, M1);
  await addMember({ org: B, user: u2, role: 'owner' }, M2);
});

afterAll(async () => {
  await pool.end();
  // invited_by is ON DELETE RESTRICT (checked per row): clear it first, then delete members, users, orgs.
  await admin.query('UPDATE org_members SET invited_by = NULL WHERE org_id = ANY($1::uuid[])', [
    orgs,
  ]);
  await admin.query('DELETE FROM org_members WHERE org_id = ANY($1::uuid[])', [orgs]);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgs]);
  await admin.end();
});

describe('users: app_role has no access (N3, case 7)', () => {
  it('SELECT, INSERT, UPDATE and DELETE are all permission denied', async () => {
    const statements = [
      'SELECT id FROM users',
      "UPDATE users SET locale = 'x'",
      'DELETE FROM users',
      `INSERT INTO users (id, email, status) VALUES ('${uuidv7()}', 'x@example.test', 'active')`,
    ];
    await withClient('app', async (c) => {
      for (const text of statements) expect(await sqlState(c.query(text)), text).toBe('42501');
    });
  });

  it('is denied inside a TenantTx too: a tenant context does not open the table', async () => {
    expect(await sqlState(withTenant(pool, ctx(A), (tx) => tx.select().from(users)))).toBe('42501');
  });

  it('holds no privilege of any kind, and the table has no RLS (Brief P8: global)', async () => {
    const privileges = await admin.query<{ priv: string; ok: boolean }>(
      `SELECT p AS priv, has_table_privilege('app_role', 'public.users', p) AS ok
       FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`,
    );
    expect(privileges.rows.filter((r) => r.ok)).toEqual([]);
    const cls = await admin.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass",
    );
    expect(cls.rows).toEqual([{ relrowsecurity: false }]);
  });
});

describe('org_members: RLS by org_id (case 1, 2, 4)', () => {
  it('case 1: without a TenantTx every statement raises TN001', async () => {
    const user = await newUser();
    await withClient('app', async (c) => {
      expect(await sqlState(c.query('SELECT id FROM org_members'))).toBe('TN001');
      expect(await sqlState(c.query("UPDATE org_members SET role = 'viewer'"))).toBe('TN001');
      const insert = c.query(
        "INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'viewer', 'active')",
        [uuidv7(), A, user],
      );
      expect(await sqlState(insert)).toBe('TN001');
    });
  });

  it('case 4: a tenant sees only its own members', async () => {
    expect(await withTenant(pool, ctx(A), memberIds)).toEqual([{ id: M1 }]);
    expect(await withTenant(pool, ctx(B), memberIds)).toEqual([{ id: M2 }]);
  });

  it("case 2: another tenant's org_id is refused (42501), its rows are untouchable", async () => {
    const user = await newUser();
    const row = { id: uuidv7(), orgId: B, userId: user, role: 'viewer', status: 'active' } as const;
    expect(
      await sqlState(withTenant(pool, ctx(A), (tx) => tx.insert(orgMembers).values(row))),
    ).toBe('42501');
    const move = withTenant(pool, ctx(A), (tx) =>
      tx.update(orgMembers).set({ orgId: B }).where(eq(orgMembers.id, M1)),
    );
    expect(await sqlState(move)).toBe('42501');
    const updated = await withTenant(pool, ctx(A), (tx) =>
      tx
        .update(orgMembers)
        .set({ role: 'admin' })
        .where(eq(orgMembers.id, M2))
        .returning({ id: orgMembers.id }),
    );
    expect(updated).toEqual([]);
  });

  it('has no DELETE for app_role, ENABLE + FORCE RLS and exactly two policies (app, support)', async () => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query('DELETE FROM org_members WHERE false'))).toBe('42501');
    });
    const cls = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.org_members'::regclass",
    );
    expect(cls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await admin.query<{ policyname: string; cmd: string; roles: string[] }>(
      "SELECT policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_members' ORDER BY policyname",
    );
    expect(policies.rows).toEqual([
      { policyname: 'org_members_app', cmd: 'ALL', roles: ['app_role'] },
      { policyname: 'org_members_support', cmd: 'SELECT', roles: ['support_role'] },
    ]);
  });

  it('lets a tenant add a member of its own org (positive control)', async () => {
    const user = await newUser();
    const id = uuidv7();
    await withTenant(pool, ctx(A), (tx) =>
      tx
        .insert(orgMembers)
        .values({ id, orgId: A, userId: user, role: 'viewer', status: 'active' }),
    );
    expect((await withTenant(pool, ctx(A), memberIds)).map((r) => r.id).sort()).toEqual(
      [M1, id].sort(),
    );
  });
});

describe('org_members: invitation columns and constraints', () => {
  const NEW = 'new'; // stands for "a fresh user"
  const email = () => `x-${uuidv7()}@example.test`;
  type Case = [name: string, base: 'invite' | 'member', over: Partial<Member>, code: string];

  async function build(base: Case[1], over: Partial<Member>): Promise<Member> {
    const merged = {
      ...(base === 'invite' ? invitation(C, email()) : { org: C, user: NEW }),
      ...over,
    };
    return { ...merged, user: merged.user === NEW ? await newUser() : (merged.user ?? null) };
  }

  it.each<Case>([
    ['pending without token hash', 'invite', { hash: null }, '23514'],
    ['pending without expiry', 'invite', { expires: null }, '23514'],
    ['pending without invited_email', 'invite', { email: null }, '23514'],
    ['token hash that is not 32 bytes', 'invite', { hash: randomBytes(31) }, '23514'],
    ['upper-case invited_email', 'invite', { email: 'Mixed@Example.test' }, '23514'],
    ['pending with a user_id', 'invite', { user: NEW }, '23514'],
    ['active without a user_id', 'member', { user: null }, '23514'],
    ['unknown role', 'member', { role: 'platform_operator' }, '23514'],
    ['unknown status', 'member', { status: 'deleted' as 'active' }, '23514'],
    ['unknown org (foreign key)', 'member', { org: uuidv7() }, '23503'],
    ['unknown user (foreign key)', 'member', { user: uuidv7() }, '23503'],
    ['invited_by that is not a member', 'member', { by: uuidv7() }, '23503'],
  ])('rejects %s', async (_name, base, over, code) => {
    expect(await sqlState(addMember(await build(base, over)))).toBe(code);
  });

  it('keeps invitations unique: token hash, and invited_email per org while pending', async () => {
    const [hash, address] = [randomBytes(32), email()];
    await addMember(invitation(C, address, { hash }));
    expect(await sqlState(addMember(invitation(D, email(), { hash })))).toBe('23505');
    expect(await sqlState(addMember(invitation(C, address)))).toBe('23505');
    await addMember(invitation(D, address)); // the same address in another org is fine
  });

  it('allows a user once per org but in several orgs', async () => {
    const user = await newUser();
    await addMember({ org: C, user });
    expect(await sqlState(addMember({ org: C, user }))).toBe('23505');
    await addMember({ org: D, user, status: 'suspended' }); // statuses: suspended is allowed
  });

  it('invited_by: NULL for the first member, a member of the same org, never one of another org', async () => {
    const [first, inviter, other] = [await newUser(), await newUser(), await newUser()];
    await addMember({ org: C, user: first, by: null });
    await addMember({ org: C, user: inviter, by: first });
    await addMember({ org: D, user: other }); // member of D only
    expect(await sqlState(addMember({ org: C, user: await newUser(), by: other }))).toBe('23503');
  });
});
