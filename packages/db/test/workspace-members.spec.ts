import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  listWorkspaceMembers,
  membersById,
  readMemberContext,
  setWorkspaceMembers,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The people of a workspace (N159) through RLS: a soft delete to leave, the same row to come back, nothing of another org.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const extra: string[] = [];
let admin: pg.Client;
let pool: pg.Pool;
let ws = '';
const inA = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [] }, fn);

/** A person who is a member of `org` with `status`; returns the member id and the user id. */
async function member(org: string, status = 'active') {
  const [user, id] = [uuidv7(), uuidv7()];
  extra.push(user);
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    user,
    `${user}@example.test`,
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', $4)`,
    [id, org, user, status],
  );
  return { id, user };
}
const rowsOf = async () =>
  (
    await admin.query<{ user_id: string; gone: boolean }>(
      'SELECT user_id, deleted_at IS NOT NULL AS gone FROM workspace_members WHERE workspace_id = $1 ORDER BY user_id',
      [ws],
    )
  ).rows;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  ws = (await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A]))
    .rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [extra]).catch(() => undefined);
  await admin.end();
});

describe('workspace members', () => {
  it('resolves only live members of the current org', async () => {
    const [sales, suspended, ofB] = [
      await member(A),
      await member(A, 'suspended'),
      await member(B),
    ];
    const pending = uuidv7();
    // prettier-ignore
    await admin.query(
      `INSERT INTO org_members (id, org_id, role, status, invited_email, invite_token_hash, invite_expires_at) VALUES ($1, $2, 'sales', 'pending', $3, $4, now() + interval '1 day')`,
      [pending, A, `${pending}@example.test`, randomBytes(32)]);
    const found = await inA((tx) => membersById(tx, [sales.id, suspended.id, ofB.id, pending]));
    expect([...found].sort()).toEqual(
      [
        [sales.id, sales.user],
        [suspended.id, suspended.user],
      ].sort(),
    );
  });

  it('sets the list: leavers get deleted_at, newcomers a row, a returning person their old row; the request context follows', async () => {
    const owner = seedUsers.get(A)!;
    const [one, two] = [await member(A), await member(A)];
    const set = (userIds: string[]) =>
      inA((tx) =>
        setWorkspaceMembers(tx, { workspaceId: ws, userIds, actorUserId: owner, newId: uuidv7 }),
      );
    expect(await set([owner, one.user])).toEqual({ added: 1, removed: 0 });
    expect(await set([owner, two.user])).toEqual({ added: 1, removed: 1 });
    expect(await set([owner, one.user, two.user])).toEqual({ added: 1, removed: 0 });
    expect(await set([owner, one.user, two.user])).toEqual({ added: 0, removed: 0 });
    expect(await rowsOf()).toEqual(
      [owner, one.user, two.user].sort().map((user_id) => ({ user_id, gone: false })),
    );
    expect(await set([owner])).toEqual({ added: 0, removed: 2 });
    expect(
      (await rowsOf())
        .filter((r) => r.gone)
        .map((r) => r.user_id)
        .sort(),
    ).toEqual([one.user, two.user].sort());
    expect((await inA((tx) => readMemberContext(tx, one.user)))?.workspaceIds).toEqual([]);
    expect((await inA((tx) => listWorkspaceMembers(tx, ws))).map((m) => m.userId)).toEqual([owner]);
  });

  it('never reaches another org: a workspace of B shows nobody and gains nobody from A', async () => {
    const wsOfB = (
      await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [B])
    ).rows[0]!.id;
    expect(await inA((tx) => listWorkspaceMembers(tx, wsOfB))).toEqual([]);
    const someone = await member(A);
    await expect(
      inA((tx) =>
        setWorkspaceMembers(tx, {
          workspaceId: wsOfB,
          userIds: [someone.user],
          actorUserId: seedUsers.get(A)!,
          newId: uuidv7,
        }),
      ),
    ).rejects.toThrow();
    const rows = await admin.query(
      'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [wsOfB, someone.user],
    );
    expect(rows.rowCount).toBe(0);
  });
});
