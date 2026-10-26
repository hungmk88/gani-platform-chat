import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, readMemberContext, readOrgSummary, withTenant } from '../src/index.js';
import { url } from './db.js';

// readMemberContext on app_role with RLS: one person in two organisations with different roles and workspaces, plus the cases
// that must NOT count (suspended, deleted, a deleted workspace, a deleted workspace membership, another person's data).
const [A, B, C] = [uuidv7(), uuidv7(), uuidv7()];
const [ME, OTHER, SUSPENDED, LEFT, STRANGER] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const [A1, A2, A3, ADEAD, ANOTMEMBER, B1] = [
  uuidv7(),
  uuidv7(),
  uuidv7(),
  uuidv7(),
  uuidv7(),
  uuidv7(),
] as [string, string, string, string, string, string];
let pool: pg.Pool;
let admin: pg.Client;

const user = (id: string) =>
  admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    id,
    `${id}@example.test`,
  ]);
const member = (org: string, who: string, role: string, status = 'active', deleted = false) =>
  admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status, deleted_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv7(), org, who, role, status, deleted ? new Date() : null],
  );
const workspace = (org: string, id: string, deleted = false) =>
  admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES ($1, $2, $3, 'W', 'service', $4)`,
    [id, org, `w-${id}`, deleted ? new Date() : null],
  );
const inWorkspace = (org: string, ws: string, who: string, deleted = false) =>
  admin.query(
    `INSERT INTO workspace_members (id, org_id, workspace_id, user_id, deleted_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), org, ws, who, deleted ? new Date() : null],
  );
const read = (org: string, who: string) =>
  withTenant(pool, { orgId: org, workspaceIds: [] }, (tx) => readMemberContext(tx, who));

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 3 });
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  for (const id of [ME, OTHER, SUSPENDED, LEFT, STRANGER]) await user(id);
  for (const org of [A, B, C]) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      org,
      `t-${org}`,
      'T',
    ]);
  }
  await member(A, ME, 'sales');
  await member(A, OTHER, 'admin');
  await member(A, SUSPENDED, 'sales', 'suspended');
  await member(A, LEFT, 'sales', 'active', true);
  await member(B, ME, 'admin');
  await member(B, OTHER, 'viewer');
  await member(C, OTHER, 'owner');
  const spaces: [string, string, boolean][] = [
    [A, A1, false],
    [A, A2, false],
    [A, A3, false],
    [A, ADEAD, true],
    [A, ANOTMEMBER, false],
    [B, B1, false],
  ];
  for (const [org, id, dead] of spaces) await workspace(org, id, dead);
  await admin.query(`UPDATE workspaces SET contact_phone = '1900 1234' WHERE id = $1`, [A1]);
  await inWorkspace(A, A1, ME);
  await inWorkspace(A, A2, ME);
  await inWorkspace(A, A3, ME, true);
  await inWorkspace(A, ADEAD, ME);
  await inWorkspace(A, A1, OTHER);
  await inWorkspace(A, ANOTMEMBER, OTHER);
  await inWorkspace(A, A1, SUSPENDED);
  await inWorkspace(A, A1, LEFT);
  await inWorkspace(B, B1, ME);
  await inWorkspace(B, B1, OTHER);
});

afterAll(async () => {
  // The order is required by the foreign keys (children first). A failing step is swallowed because the CI database is ephemeral.
  const steps = [
    'DELETE FROM workspace_members WHERE org_id = ANY($1::uuid[])',
    'DELETE FROM workspaces WHERE org_id = ANY($1::uuid[])',
    'DELETE FROM org_members WHERE org_id = ANY($1::uuid[])',
  ];
  for (const step of steps) await admin.query(step, [[A, B, C]]).catch(() => undefined);
  await admin
    .query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B, C]])
    .catch(() => undefined);
  await admin
    .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ME, OTHER, SUSPENDED, LEFT, STRANGER]])
    .catch(() => undefined);
  await admin.end();
  await pool.end();
});

describe('readMemberContext', () => {
  it('returns the role and the live workspaces of the organisation of the transaction', async () => {
    expect(await read(A, ME)).toEqual({ role: 'sales', workspaceIds: [A1, A2].sort() });
  });

  it('gives the same person another role and other workspaces in another organisation', async () => {
    expect(await read(B, ME)).toEqual({ role: 'admin', workspaceIds: [B1] });
  });

  it('keeps people of the same organisation apart', async () => {
    expect(await read(A, OTHER)).toEqual({ role: 'admin', workspaceIds: [A1, ANOTMEMBER].sort() });
    expect(await read(B, OTHER)).toEqual({ role: 'viewer', workspaceIds: [B1] });
  });

  it('is null for an organisation the person does not belong to (RLS shows nothing of it)', async () => {
    expect(await read(C, ME)).toBeNull();
    expect(await read(C, STRANGER)).toBeNull();
  });

  it('is null for a suspended member and for a member who was deleted', async () => {
    expect(await read(A, SUSPENDED)).toBeNull();
    expect(await read(A, LEFT)).toBeNull();
  });

  it('is an empty workspace list for a member who is in no workspace', async () => {
    expect(await read(C, OTHER)).toEqual({ role: 'owner', workspaceIds: [] });
  });

  it('is null for a user id that does not exist', async () => {
    expect(await read(A, uuidv7())).toBeNull();
  });

  it('fails loudly without a tenant context instead of answering empty', async () => {
    await expect(pool.query('SELECT 1 FROM org_members LIMIT 1')).rejects.toThrow();
  });
});

describe('readOrgSummary', () => {
  const summary = (org: string, ids: string[]) =>
    withTenant(pool, { orgId: org, workspaceIds: ids }, (tx) => readOrgSummary(tx, ids));

  it('names the organisation of the transaction and the live workspaces asked for, with their contact number', async () => {
    expect(await summary(A, [A1, A2])).toEqual({
      org: { id: A, name: 'T' },
      workspaces: [A1, A2]
        .sort()
        .map((id) => ({ id, name: 'W', contactPhone: id === A1 ? '1900 1234' : null })),
    });
    expect(await summary(C, [])).toEqual({ org: { id: C, name: 'T' }, workspaces: [] });
  });

  it('leaves out a deleted workspace and one of another organisation (RLS)', async () => {
    expect(await summary(A, [A1, ADEAD, B1])).toEqual({
      org: { id: A, name: 'T' },
      workspaces: [{ id: A1, name: 'W', contactPhone: '1900 1234' }],
    });
  });
});
