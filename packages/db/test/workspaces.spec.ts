import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  workspaceMembers,
  workspaces,
  withTenant,
  type TenantTx,
} from '../src/index.js';
import { sqlState, url, withClient } from './db.js';

// Spec RLS M01 §7 cases 1, 2, 3 for workspaces and workspace_members, plus the N62/N63 constraints.
const [A, B] = [uuidv7(), uuidv7()];
const [WA, WB] = [uuidv7(), uuidv7()];
const userIds: string[] = [];
let pool: pg.Pool;
let admin: pg.Client;
let uA: string;
let uB: string;

const ctx = (orgId: string) => ({ orgId, workspaceIds: [] });
const wsIds = (tx: TenantTx) => tx.select({ id: workspaces.id }).from(workspaces);

async function newUser(): Promise<string> {
  const id = uuidv7();
  userIds.push(id);
  await admin.query("INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')", [
    id,
    `${id}@example.test`,
  ]);
  return id;
}

function addOrgMember(org: string, user: string | null, status = 'active') {
  const pending = status === 'pending';
  return admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, invited_email, invite_token_hash, invite_expires_at)
     VALUES ($1, $2, $3, 'viewer', $4, $5, $6, $7)`,
    [
      uuidv7(),
      org,
      user,
      status,
      pending ? `p-${uuidv7()}@example.test` : null,
      pending ? randomBytes(32) : null,
      pending ? new Date(Date.now() + 86_400_000) : null,
    ],
  );
}

interface WorkspaceOver {
  slug?: string;
  name?: string;
  template?: string;
  max?: number;
  by?: string | null;
}
function addWorkspace(org: string, over: WorkspaceOver = {}, id = uuidv7()) {
  const v = { slug: `w-${id}`, name: 'W', template: 'service', max: 5, by: null, ...over };
  return admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template, default_max_concurrent, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, org, v.slug, v.name, v.template, v.max, v.by],
  );
}

const wsMember = (org: string, workspace: string, user: string, by: string | null = null) => ({
  id: uuidv7(),
  orgId: org,
  workspaceId: workspace,
  userId: user,
  createdBy: by,
});
const joinAs = (org: string, row: ReturnType<typeof wsMember>) =>
  sqlState(withTenant(pool, ctx(org), (tx) => tx.insert(workspaceMembers).values(row)));

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  for (const id of [A, B]) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      `t-${id}`,
      'Test',
    ]);
  }
  [uA, uB] = [await newUser(), await newUser()];
  await addOrgMember(A, uA);
  await addOrgMember(B, uB);
  await addWorkspace(A, {}, WA);
  await addWorkspace(B, {}, WB);
});

afterAll(async () => {
  await pool.end();
  for (const table of ['workspace_members', 'workspaces', 'org_members']) {
    await admin.query(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [[A, B]]);
  }
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B]]);
  await admin.end();
});

describe.each(['workspaces', 'workspace_members'])('%s: RLS by org_id', (table) => {
  it('case 1: without a TenantTx SELECT and UPDATE raise TN001', async () => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query(`SELECT id FROM ${table}`))).toBe('TN001');
      expect(await sqlState(c.query(`UPDATE ${table} SET updated_at = now()`))).toBe('TN001');
    });
  });

  it('has no DELETE, ENABLE + FORCE RLS and exactly two policies (app, support)', async () => {
    await withClient('app', async (c) => {
      expect(await sqlState(c.query(`DELETE FROM ${table} WHERE false`))).toBe('42501');
    });
    const cls = await admin.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
      [`public.${table}`],
    );
    expect(cls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const pol = await admin.query(
      "SELECT policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname",
      [table],
    );
    expect(pol.rows).toEqual([
      { policyname: `${table}_app`, cmd: 'ALL', roles: ['app_role'] },
      { policyname: `${table}_support`, cmd: 'SELECT', roles: ['support_role'] },
    ]);
  });
});

describe('isolation between tenants', () => {
  it('a tenant sees only its own workspaces', async () => {
    expect(await withTenant(pool, ctx(A), wsIds)).toEqual([{ id: WA }]);
    expect(await withTenant(pool, ctx(B), wsIds)).toEqual([{ id: WB }]);
  });

  it('case 2: rows for another org_id are refused (42501) on both tables', async () => {
    const ws = { id: uuidv7(), orgId: B, slug: 'zz', name: 'x', template: 'service' } as const;
    const insertWs = withTenant(pool, ctx(A), (tx) => tx.insert(workspaces).values(ws));
    expect(await sqlState(insertWs)).toBe('42501');
    expect(await joinAs(A, wsMember(B, WB, uB))).toBe('42501');
  });

  it('case 3: workspace_members of org A pointing at a workspace of org B is refused (23503)', async () => {
    expect(await joinAs(A, wsMember(A, WB, uA))).toBe('23503');
  });

  it('a user who is only a member of another org cannot enter a workspace (23503)', async () => {
    expect(await joinAs(A, wsMember(A, WA, uB))).toBe('23503');
  });

  it('a user with only a pending invitation cannot enter a workspace (23503, N63)', async () => {
    const invitee = await newUser();
    await addOrgMember(A, null, 'pending');
    expect(await joinAs(A, wsMember(A, WA, invitee))).toBe('23503');
  });

  it('lets a member join a workspace of its own org, once (positive control)', async () => {
    expect(await joinAs(A, wsMember(A, WA, uA, uA))).toBeUndefined();
    expect(await joinAs(A, wsMember(A, WA, uA))).toBe('23505');
  });
});

describe('workspaces: constraints (N62)', () => {
  it.each<[string, WorkspaceOver]>([
    ['upper case', { slug: 'Ab' }],
    ['one character', { slug: 'a' }],
    ['a space', { slug: 'a b' }],
    ['leading hyphen', { slug: '-ab' }],
    ['trailing hyphen', { slug: 'ab-' }],
    ['double hyphen', { slug: 'a--b' }],
    ['64 characters', { slug: 'a'.repeat(64) }],
    ['unknown template', { template: 'retail' }],
    ['blank name', { name: '  ' }],
    ['default_max_concurrent of 0', { max: 0 }],
  ])('rejects %s', async (_name, over) => {
    expect(await sqlState(addWorkspace(A, over))).toBe('23514');
  });

  it('accepts slugs of 2 and 63 characters, and the same slug in another org', async () => {
    await addWorkspace(A, { slug: 'ab' });
    await addWorkspace(A, { slug: 'a'.repeat(63) });
    await addWorkspace(B, { slug: 'ab' });
  });

  it('keeps a slug unique per org even after the workspace is soft deleted', async () => {
    const id = uuidv7();
    await addWorkspace(A, { slug: 'retired' }, id);
    await admin.query('UPDATE workspaces SET deleted_at = now() WHERE id = $1', [id]);
    expect(await sqlState(addWorkspace(A, { slug: 'retired' }))).toBe('23505');
  });

  it('created_by must be a member of the same org (23503 otherwise)', async () => {
    await addWorkspace(A, { by: uA });
    expect(await sqlState(addWorkspace(A, { by: uB }))).toBe('23503');
    expect(await sqlState(addWorkspace(A, { by: uuidv7() }))).toBe('23503');
  });
});
