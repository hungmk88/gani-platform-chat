import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, teamMembers, teams, withTenant, type TenantTx } from '../src/index.js';
import { sqlState, url } from './db.js';

// Spec RLS M01 §7 cases 2, 3 (case 1 is in rls-all-tables.spec) for teams and team_members, and the company-wide team (workspace_id NULL, N14).
const [A, B, WA, WB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const userIds: string[] = [];
let pool: pg.Pool;
let admin: pg.Client;
let uA: string;
let uB: string;

const ctx = (orgId: string, workspaceIds: string[] = []) => ({ orgId, workspaceIds });
const teamIds = (tx: TenantTx) => tx.select({ id: teams.id }).from(teams);

async function newUser(): Promise<string> {
  const id = uuidv7();
  userIds.push(id);
  await admin.query("INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')", [
    id,
    `${id}@example.test`,
  ]);
  return id;
}

const addOrgMember = (org: string, user: string) =>
  admin.query(
    "INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'viewer', 'active')",
    [uuidv7(), org, user],
  );

interface TeamOver {
  workspace?: string | null;
  slug?: string;
  name?: string;
  by?: string | null;
}
function addTeam(org: string, over: TeamOver = {}, id = uuidv7()) {
  const v = { workspace: null, slug: `t-${id}`, name: 'T', by: null, ...over };
  return admin.query(
    'INSERT INTO teams (id, org_id, workspace_id, slug, name, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, org, v.workspace, v.slug, v.name, v.by],
  );
}

const member = (org: string, team: string, user: string) => ({
  id: uuidv7(),
  orgId: org,
  teamId: team,
  userId: user,
});
const joinAs = (org: string, row: ReturnType<typeof member>) =>
  sqlState(withTenant(pool, ctx(org), (tx) => tx.insert(teamMembers).values(row)));

let TA = '';
let TB = '';
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
  for (const [org, ws] of [
    [A, WA],
    [B, WB],
  ] as const) {
    await admin.query(
      "INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws', 'W', 'service')",
      [ws, org],
    );
  }
  [TA, TB] = [uuidv7(), uuidv7()];
  await addTeam(A, { workspace: WA }, TA);
  await addTeam(B, { workspace: WB }, TB);
});

afterAll(async () => {
  await pool.end();
  for (const table of ['team_members', 'teams', 'workspaces', 'org_members']) {
    await admin.query(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [[A, B]]);
  }
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  await admin.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B]]);
  await admin.end();
});

describe('isolation between tenants', () => {
  it('a tenant sees only its own teams', async () => {
    expect(await withTenant(pool, ctx(A), teamIds)).toEqual([{ id: TA }]);
    expect(await withTenant(pool, ctx(B), teamIds)).toEqual([{ id: TB }]);
  });

  it('case 2: rows for another org_id are refused (42501) on both tables', async () => {
    const team = { id: uuidv7(), orgId: B, slug: 'zz', name: 'x' };
    expect(await sqlState(withTenant(pool, ctx(A), (tx) => tx.insert(teams).values(team)))).toBe(
      '42501',
    );
    expect(await joinAs(A, member(B, TB, uB))).toBe('42501');
  });

  it('case 3: a team_member of org A pointing at a team of org B is refused (23503)', async () => {
    expect(await joinAs(A, member(A, TB, uA))).toBe('23503');
  });

  it('a user of another org, or with only a pending invitation, cannot join a team (23503, N63)', async () => {
    expect(await joinAs(A, member(A, TA, uB))).toBe('23503');
    const invitee = await newUser();
    await admin.query(
      `INSERT INTO org_members (id, org_id, role, status, invited_email, invite_token_hash, invite_expires_at)
       VALUES ($1, $2, 'viewer', 'pending', $3, $4, now() + interval '1 day')`,
      [uuidv7(), A, `${invitee}@example.test`, randomBytes(32)],
    );
    expect(await joinAs(A, member(A, TA, invitee))).toBe('23503');
  });

  it('lets a member join a team of its own org, once (positive control)', async () => {
    expect(await joinAs(A, member(A, TA, uA))).toBeUndefined();
    expect(await joinAs(A, member(A, TA, uA))).toBe('23505');
  });
});

describe('company-wide team (workspace_id NULL)', () => {
  it('is visible whatever workspaces the session holds, and not to another org', async () => {
    const id = uuidv7();
    await addTeam(A, { slug: 'company', workspace: null }, id);
    const none = await withTenant(pool, ctx(A), teamIds);
    const other = await withTenant(pool, ctx(A, [WA]), teamIds);
    expect(none.map((r) => r.id)).toContain(id);
    expect(other.map((r) => r.id)).toContain(id);
    expect((await withTenant(pool, ctx(B), teamIds)).map((r) => r.id)).not.toContain(id);
  });

  it('refuses a duplicate slug per scope (NULLS NOT DISTINCT) but not across scopes or orgs', async () => {
    await addTeam(A, { slug: 'ops' });
    expect(await sqlState(addTeam(A, { slug: 'ops' }))).toBe('23505');
    await addTeam(A, { slug: 'ops', workspace: WA });
    await addTeam(B, { slug: 'ops' });
    expect(await sqlState(addTeam(A, { slug: 'ops', workspace: WA }))).toBe('23505');
  });
});

describe('teams: constraints', () => {
  it.each<[string, TeamOver]>([['upper case slug', { slug: 'Ab' }]])(
    'rejects %s',
    async (_name, over) => {
      expect(await sqlState(addTeam(A, over))).toBe('23514');
    },
  );

  it('workspace and created_by must belong to the same org (23503 otherwise)', async () => {
    await addTeam(A, { by: uA });
    expect(await sqlState(addTeam(A, { by: uB }))).toBe('23503');
    expect(await sqlState(addTeam(A, { workspace: WB }))).toBe('23503');
  });
});
