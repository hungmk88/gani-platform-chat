import { CONVERSATION_STATES, uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDbPool, listAssigneeCandidates, withTenant } from '../src/index.js';
import { sqlState, url } from './db.js';

// listAssigneeCandidates and app.held_conversation_counts_by_state on app_role (U31, N168). Organisation A: the viewer (Sales of W1)
// and the people of W1 who may or may not receive; W2 holds conversations that still count, a deleted workspace ones that do not;
// organisation B shares a person with A, whose conversations there never count in A. HUMAN_ACTIVE is the load (openCount),
// PENDING_CUSTOMER is counted apart (awaitingCustomerCount, Brief §M04).
const [A, B] = [uuidv7(), uuidv7()];
const [W1, W2, WDEAD, BW] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const [VIEWER, MATE, MULTI, OTHERTEAM, NONAME, MARKETING, SUSPENDED, LEFT, W2ONLY] = Array.from(
  { length: 9 },
  () => uuidv7(),
) as [string, string, string, string, string, string, string, string, string];
const PEOPLE = [VIEWER, MATE, MULTI, OTHERTEAM, NONAME, MARKETING, SUSPENDED, LEFT, W2ONLY];
const [SHARED, ALPHA, GONE] = [uuidv7(), uuidv7(), uuidv7()];
let pool: pg.Pool;
let admin: pg.Client;

const q = (text: string, values: unknown[]) => admin.query(text, values);
const person = async (who: string, name: string | null, role: string, status = 'active') => {
  await q(`INSERT INTO users (id, email, status, display_name) VALUES ($1, $2, 'active', $3)`, [
    who,
    `${who}@example.test`,
    name,
  ]);
  await q(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), A, who, role, status],
  );
};
const inWorkspace = (org: string, ws: string, who: string, left = false) =>
  q(
    `INSERT INTO workspace_members (id, org_id, workspace_id, user_id, deleted_at) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), org, ws, who, left ? new Date() : null],
  );
const inTeam = (team: string, who: string) =>
  q(`INSERT INTO team_members (id, org_id, team_id, user_id) VALUES ($1, $2, $3, $4)`, [
    uuidv7(),
    A,
    team,
    who,
  ]);
const held = (org: string, ws: string, who: string, state = 'HUMAN_ACTIVE') =>
  q(
    `INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), org, ws, state, who],
  );
const list = (org: string, workspaces: string[], teammatesOnly = false) =>
  withTenant(pool, { orgId: org, workspaceIds: workspaces }, (tx) =>
    listAssigneeCandidates(tx, { workspaceId: W1, viewerId: VIEWER, teammatesOnly }),
  );

beforeAll(async () => {
  pool = createDbPool(url('app'), { max: 2 });
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  for (const org of [A, B])
    await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      org,
      `t-${org}`,
      'T',
    ]);
  for (const [org, ws, deleted] of [
    [A, W1, null],
    [A, W2, null],
    [A, WDEAD, new Date()],
    [B, BW, null],
  ] as const)
    await q(
      `INSERT INTO workspaces (id, org_id, slug, name, template, default_max_concurrent, deleted_at)
       VALUES ($1, $2, $3, 'W', 'service', 7, $4)`,
      [ws, org, `w-${ws}`, deleted],
    );
  await person(VIEWER, 'Vy', 'sales');
  await person(MATE, ' An ', 'support');
  await person(MULTI, 'Minh', 'manager');
  await person(OTHERTEAM, 'Binh', 'sales');
  await person(NONAME, null, 'support');
  await person(MARKETING, 'Mai', 'marketing');
  await person(SUSPENDED, 'Son', 'sales', 'suspended');
  await person(LEFT, 'Lan', 'sales');
  await person(W2ONLY, 'Hoa', 'sales');
  for (const who of [VIEWER, MATE, MULTI, OTHERTEAM, NONAME, MARKETING, SUSPENDED])
    await inWorkspace(A, W1, who);
  await inWorkspace(A, W1, LEFT, true);
  await inWorkspace(A, W2, W2ONLY);
  // SHARED (named last) is the viewer's team; ALPHA is another team of W1; GONE is a deleted team, named first.
  for (const [team, name, deleted] of [
    [SHARED, 'Zeta', null],
    [ALPHA, 'Alpha', null],
    [GONE, 'Aaa', new Date()],
  ] as const)
    await q(
      `INSERT INTO teams (id, org_id, workspace_id, name, slug, deleted_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [team, A, W1, name, `t-${team}`, deleted],
    );
  for (const who of [VIEWER, MATE, MULTI]) await inTeam(SHARED, who);
  for (const who of [MULTI, OTHERTEAM]) await inTeam(ALPHA, who);
  // The viewer is in GONE too, so a deleted team would win both the shared and the name order.
  for (const who of [VIEWER, MATE]) await inTeam(GONE, who);
  await q(
    `INSERT INTO agent_settings (id, org_id, user_id, max_concurrent_conversations) VALUES ($1, $2, $3, 3)`,
    [uuidv7(), A, MATE],
  );
  // MATE: two active in W1, one in W2 (the viewer cannot see W2), one waiting for the customer; MULTI: only waiting ones. The deleted
  // workspace and organisation B do not count.
  await held(A, W1, MATE);
  await held(A, W1, MATE);
  await held(A, W2, MATE);
  await held(A, W1, MATE, 'PENDING_CUSTOMER');
  await held(A, WDEAD, MATE);
  await held(A, W2, MULTI, 'PENDING_CUSTOMER');
  await held(A, WDEAD, MULTI, 'PENDING_CUSTOMER');
  await q(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
    [uuidv7(), B, MATE],
  );
  await held(B, BW, MATE);
});

afterAll(async () => {
  for (const table of [
    'conversations',
    'agent_settings',
    'team_members',
    'teams',
    'workspace_members',
    'workspaces',
    'org_members',
  ])
    await q(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, [[A, B]]).catch(() => undefined);
  await q('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[A, B]]).catch(() => undefined);
  await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [PEOPLE]).catch(() => undefined);
  await admin.end();
  await pool.end();
});

describe('listAssigneeCandidates', () => {
  it('lists the active members of the workspace by name (no name last), with their team, held count and limit', async () => {
    expect(await list(A, [W1])).toEqual([
      {
        userId: MATE,
        name: 'An',
        role: 'support',
        teamId: SHARED,
        teamName: 'Zeta',
        openCount: 3,
        awaitingCustomerCount: 1,
        maxConcurrent: 3,
      },
      {
        userId: OTHERTEAM,
        name: 'Binh',
        role: 'sales',
        teamId: ALPHA,
        teamName: 'Alpha',
        openCount: 0,
        awaitingCustomerCount: 0,
        maxConcurrent: 7,
      },
      {
        userId: MARKETING,
        name: 'Mai',
        role: 'marketing',
        teamId: null,
        teamName: null,
        openCount: 0,
        awaitingCustomerCount: 0,
        maxConcurrent: 7,
      },
      {
        userId: MULTI,
        name: 'Minh',
        role: 'manager',
        teamId: SHARED,
        teamName: 'Zeta',
        openCount: 0,
        awaitingCustomerCount: 1,
        maxConcurrent: 7,
      },
      {
        userId: VIEWER,
        name: 'Vy',
        role: 'sales',
        teamId: SHARED,
        teamName: 'Zeta',
        openCount: 0,
        awaitingCustomerCount: 0,
        maxConcurrent: 7,
      },
      {
        userId: NONAME,
        name: null,
        role: 'support',
        teamId: null,
        teamName: null,
        openCount: 0,
        awaitingCustomerCount: 0,
        maxConcurrent: 7,
      },
    ]);
  });

  it('with teammatesOnly, keeps those who share a team with the viewer (the viewer included, as shareTeam reads it)', async () => {
    expect((await list(A, [W1], true)).map((c) => c.userId)).toEqual([MATE, MULTI, VIEWER]);
  });

  it('counts held conversations in workspaces the caller cannot see, and is the same with no workspace in the context', async () => {
    const [mate] = await list(A, []);
    expect(mate).toMatchObject({ userId: MATE, openCount: 3, awaitingCustomerCount: 1 });
  });

  it('counts only HUMAN_ACTIVE and PENDING_CUSTOMER: no other state, present or future, can be held at all', async () => {
    // The CHECK of 202610061100 refuses an assignee in every other state, so nothing else can reach either count; a state added one day
    // is refused too until that CHECK changes, and then the function still names its two states one by one.
    const others = CONVERSATION_STATES.filter(
      (s) => s !== 'HUMAN_ACTIVE' && s !== 'PENDING_CUSTOMER',
    );
    expect(others.length).toBeGreaterThan(0);
    for (const state of others)
      expect(await sqlState(held(A, W1, NONAME, state)), state).toBe('23514');
    const [mate] = await list(A, [W1]);
    expect(mate).toMatchObject({ openCount: 3, awaitingCustomerCount: 1 });
  });

  it('shows nothing of another organisation, and fails loudly without a tenant', async () => {
    expect(await list(B, [BW])).toEqual([]);
    expect(
      await sqlState(
        pool.query('SELECT * FROM app.held_conversation_counts_by_state($1::uuid[])', [[MATE]]),
      ),
    ).toBe('TN001');
  });
});

// held_conversation_counts_by_state replaces held_conversation_counts (202610301000); the old one stays until a separate PR drops it.
describe.each([
  [
    'held_conversation_counts_by_state',
    'TABLE(user_id uuid, active bigint, awaiting_customer bigint)',
  ],
  ['held_conversation_counts', 'TABLE(user_id uuid, held bigint)'],
])('app.%s', (name, result) => {
  it('is a SECURITY DEFINER function with a fixed search_path that only app_role may run', async () => {
    const fn = await admin.query<{ definer: boolean; result: string; config: string[] }>(
      `SELECT prosecdef AS definer, pg_get_function_result(oid) AS result, proconfig AS config
       FROM pg_proc WHERE proname = $1`,
      [name],
    );
    expect(fn.rows).toEqual([
      { definer: true, result, config: ['search_path=pg_catalog, public, pg_temp'] },
    ]);
    const { rows } = await admin.query<{ r: string; ok: boolean }>(
      `SELECT r, has_function_privilege(r, $1, 'EXECUTE') AS ok
       FROM unnest(ARRAY['app_role', 'auth_role', 'support_role', 'public']) AS r`,
      [`app.${name}(uuid[])`],
    );
    expect(rows.filter((x) => x.ok).map((x) => x.r)).toEqual(['app_role']);
  });
});
