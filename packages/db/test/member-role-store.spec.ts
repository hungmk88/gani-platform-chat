import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  authSchema,
  createAuthDb,
  createDbPool,
  lockActiveOwners,
  lockMember,
  updateMemberRole,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The change of a member's role (member-role-store.ts, N154) as app_role with RLS, and the Drizzle handle of Better Auth
// (auth-db.ts) as auth_role. The API calls both; these cases are the ones of the package itself (coverage per file, 30/10).
const [A, B] = [uuidv7(), uuidv7()];
const users = new Map<string, string>();
const extra: string[] = [];
let admin: pg.Client;
let pool: pg.Pool;
let authPool: pg.Pool;
let [ownerA, owner2, removed, adminMember, pending, ofB] = ['', '', '', '', '', ''];

const inA = <T>(fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);

// A member of `org` with a user of its own, as migration_role.
async function member(org: string, role: string, status = 'active', deleted = false) {
  const [id, user] = [uuidv7(), uuidv7()];
  extra.push(user);
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    user,
    `${user}@example.test`,
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, deleted_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END)`,
    [id, org, user, role, status, deleted],
  );
  return id;
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 3 });
  authPool = createDbPool(url('auth'), { max: 1 });
  for (const org of [A, B]) users.set(org, await seedTenant(admin, org));
  const seeded = await admin.query<{ id: string }>('SELECT id FROM org_members WHERE org_id = $1', [
    A,
  ]);
  ownerA = seeded.rows[0]?.id as string;
  owner2 = await member(A, 'owner');
  await member(A, 'owner', 'suspended');
  removed = await member(A, 'owner', 'active', true);
  adminMember = await member(A, 'admin');
  ofB = await member(B, 'admin');
  pending = uuidv7();
  await admin.query(
    `INSERT INTO org_members (id, org_id, role, status, invited_email, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, 'sales', 'pending', $3, $4, now() + interval '7 days')`,
    [pending, A, `${pending}@example.test`, randomBytes(32)],
  );
});

afterAll(async () => {
  await pool.end();
  await authPool.end();
  for (const [org, user] of users) await cleanupTenant(admin, org, user);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [extra]).catch(() => undefined);
  await admin.end();
});

describe('lockActiveOwners', () => {
  it('gives the active Owners of the organisation by id: not a suspended or deleted one, not another role', async () => {
    expect(await inA(lockActiveOwners)).toEqual([ownerA, owner2].sort());
  });

  it('keeps them locked until the end of the transaction: another one cannot lock them (55P03)', async () => {
    const other = await inA(async (tx) => {
      await lockActiveOwners(tx);
      return sqlState(
        inA((tx2) =>
          tx2.execute(sql`SELECT 1 FROM org_members WHERE id = ${owner2} FOR UPDATE NOWAIT`),
        ),
      );
    });
    expect(other).toBe('55P03');
  });
});

describe('lockMember and updateMemberRole', () => {
  it('finds a member, never an invitation, a deleted member or a member of another organisation', async () => {
    const { rows } = await admin.query<{ user_id: string }>(
      'SELECT user_id FROM org_members WHERE id = $1',
      [adminMember],
    );
    const user = rows[0]?.user_id;
    expect(await inA((tx) => lockMember(tx, adminMember))).toEqual({
      id: adminMember,
      userId: user,
      role: 'admin',
    });
    for (const id of [pending, removed, ofB])
      expect(await inA((tx) => lockMember(tx, id))).toBeNull();
  });

  it('changes the role of the member it locked', async () => {
    await inA(async (tx) => {
      expect(await lockMember(tx, adminMember)).not.toBeNull();
      await updateMemberRole(tx, adminMember, 'manager');
    });
    const { rows } = await admin.query('SELECT role FROM org_members WHERE id = $1', [adminMember]);
    expect(rows).toEqual([{ role: 'manager' }]);
  });
});

describe('createAuthDb', () => {
  it('reads the auth tables through the pool of auth_role, and nothing else (42501)', async () => {
    const db = createAuthDb(authPool);
    const user = users.get(A) as string;
    const found = await db
      .select({ id: authSchema.users.id })
      .from(authSchema.users)
      .where(eq(authSchema.users.id, user));
    expect(found).toEqual([{ id: user }]);
    expect(await sqlState(db.execute(sql`SELECT 1 FROM org_members LIMIT 1`))).toBe('42501');
  });
});
