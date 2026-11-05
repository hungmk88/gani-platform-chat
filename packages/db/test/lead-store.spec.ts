import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  getLead,
  LeadAccessDeniedError,
  listLeads,
  readPipeline,
  withTenant,
  type LeadQuery,
  type LeadViewer,
  type OrgRole,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Reading leads (L3a-1, N188, N196, N201) as app_role through RLS: every role's scope applied by the store, newest first a page at a
// time without losing a lead that shares its creation time, and one lead with its events, oldest first, at most 500.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const people = { sales: uuidv7(), other: uuidv7() };
const ids = { ws: '', ws2: '', stage: '', stage2: '', customer: '', stageWs2: '' };
const lead = { made: uuidv7(), owned: uuidv7(), theirs: uuidv7(), older: uuidv7(), ws2: uuidv7() };
let admin: pg.Client;
let pool: pg.Pool;

const viewer = (role: OrgRole, userId = people.sales): LeadViewer => ({ role, userId });
const inWs = <T>(fn: Parameters<typeof withTenant<T>>[2], workspaces = [ids.ws], org = A) =>
  withTenant(pool, { orgId: org, workspaceIds: workspaces }, fn);
const list = (
  v: LeadViewer,
  q: Omit<LeadQuery, 'limit'> & { limit?: number } = {},
  workspaces = [ids.ws],
) => inWs((tx) => listLeads(tx, v, { limit: 50, ...q }), workspaces);
const idsOf = async (v: LeadViewer, q: Omit<LeadQuery, 'limit'> = {}) =>
  (await list(v, q)).rows.map((r) => r.id).sort();

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  const one = async (sql: string) =>
    (await admin.query<{ id: string }>(sql, [A])).rows[0]?.id as string;
  ids.ws = await one('SELECT id FROM workspaces WHERE org_id = $1');
  ids.stage = await one('SELECT id FROM pipeline_stages WHERE org_id = $1');
  ids.customer = await one('SELECT id FROM customers WHERE org_id = $1');
  [ids.ws2, ids.stage2, ids.stageWs2] = [uuidv7(), uuidv7(), uuidv7()];
  for (const [role, id] of Object.entries(people)) {
    await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
      id,
      `${id}@example.test`,
    ]);
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`,
      [uuidv7(), A, id, role === 'sales' ? 'sales' : 'manager'],
    );
  }
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [ids.ws2, A],
  );
  await admin.query(
    `INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'Bước 2', 1), ($4, $2, $5, 'Bước 1', 0)`,
    [ids.stage2, A, ids.ws, ids.stageWs2, ids.ws2],
  );
  // The seed lead of fixtures.ts is out of the way of these tests.
  await admin.query('DELETE FROM lead_events WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM leads WHERE org_id = $1', [A]);
  // Three leads made at the very same time (a page boundary falls between them), one made earlier, one in ws2.
  const at = '2026-11-05T08:00:00.000001Z';
  const insert = (
    id: string,
    by: string,
    owner: string | null,
    stage: string,
    ws = ids.ws,
    when = at,
  ) =>
    admin.query(
      `INSERT INTO leads (id, org_id, workspace_id, title, customer_id, stage_id, owner_user_id, created_by, created_at)
       VALUES ($1, $2, $3, 'Báo giá', $4, $5, $6, $7, $8)`,
      [id, A, ws, ids.customer, stage, owner, by, when],
    );
  await insert(lead.made, people.sales, null, ids.stage);
  await insert(lead.owned, people.other, people.sales, ids.stage2);
  await insert(lead.theirs, people.other, people.other, ids.stage);
  await insert(lead.older, people.other, null, ids.stage, ids.ws, '2026-11-01T08:00:00Z');
  await insert(lead.ws2, people.other, null, ids.stageWs2, ids.ws2);
  await admin.query(
    `INSERT INTO lead_events (id, org_id, workspace_id, lead_id, type, to_stage_id, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, $4, 'created', $5, $6, '2026-11-05T08:00:00Z')`,
    [uuidv7(), A, ids.ws, lead.made, ids.stage, people.sales],
  );
  await admin.query(
    `INSERT INTO lead_events (id, org_id, workspace_id, lead_id, type, from_stage_id, to_stage_id, actor_user_id, occurred_at)
     VALUES ($1, $2, $3, $4, 'stage_changed', $5, $6, $7, '2026-11-05T09:00:00Z')`,
    [uuidv7(), A, ids.ws, lead.made, ids.stage, ids.stage2, people.sales],
  );
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(people)]);
  await admin.end();
});

describe('listLeads', () => {
  it('gives a Manager every lead of the session’s workspaces, newest first, and a page boundary inside a tie loses none', async () => {
    const manager = viewer('manager', people.other);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(manager, { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const tied = [lead.made, lead.owned, lead.theirs].sort().reverse();
    expect(seen).toEqual([...tied, lead.older]);
    expect((await list(manager, {}, [ids.ws, ids.ws2])).rows).toHaveLength(5);
  });

  it('narrows a Sales to the leads they made or own, whatever the filters', async () => {
    const sales = viewer('sales');
    expect(await idsOf(sales)).toEqual([lead.made, lead.owned].sort());
    expect(await idsOf(sales, { stageId: ids.stage })).toEqual([lead.made]);
    expect(await idsOf(sales, { createdBy: people.other })).toEqual([lead.owned]);
    expect(await idsOf(sales, { owner: people.other })).toEqual([]);
  });

  it('filters by step, state, owner, maker and customer in the same WHERE as the scope', async () => {
    const owner = viewer('owner', seedUsers.get(A));
    expect(await idsOf(owner, { stageId: ids.stage2 })).toEqual([lead.owned]);
    expect(await idsOf(owner, { owner: 'none' })).toEqual([lead.made, lead.older].sort());
    expect(await idsOf(owner, { owner: people.other })).toEqual([lead.theirs]);
    expect(await idsOf(owner, { createdBy: people.sales })).toEqual([lead.made]);
    expect(await idsOf(owner, { status: 'won' })).toEqual([]);
    expect((await idsOf(owner, { customerId: ids.customer })).length).toBe(4);
    for (const role of ['marketing', 'viewer'] as const)
      expect((await idsOf(viewer(role))).length).toBe(4);
  });

  it('refuses Support with LeadAccessDeniedError, never an empty page, and a bad limit or state before any query', async () => {
    await expect(list(viewer('support'))).rejects.toThrow(LeadAccessDeniedError);
    await expect(list(viewer('owner'), { limit: 101 })).rejects.toThrow(RangeError);
    await expect(list(viewer('owner'), { status: 'pending' as never })).rejects.toThrow(RangeError);
  });
});

describe('getLead', () => {
  it('gives a lead with its events oldest first and the names of its steps', async () => {
    const detail = await inWs((tx) => getLead(tx, viewer('sales'), lead.made));
    expect(detail?.lead).toMatchObject({
      id: lead.made,
      stageName: 'Seed',
      status: 'open',
      title: 'Báo giá',
    });
    expect(
      detail?.events.map((e) => [e.type, e.fromStage?.name ?? null, e.toStage?.name ?? null]),
    ).toEqual([
      ['created', null, 'Seed'],
      ['stage_changed', 'Seed', 'Bước 2'],
    ]);
    expect(detail?.eventsCapped).toBe(false);
  });

  it('answers null for a lead the person may not see, outside the session or of another organisation; Support throws', async () => {
    // A Sales reads a lead they follow but did not make, and not one of someone else.
    expect((await inWs((tx) => getLead(tx, viewer('sales'), lead.owned)))?.lead.id).toBe(
      lead.owned,
    );
    expect(await inWs((tx) => getLead(tx, viewer('sales'), lead.theirs))).toBeNull();
    expect(await inWs((tx) => getLead(tx, viewer('owner', seedUsers.get(A)), lead.ws2))).toBeNull();
    expect(await inWs((tx) => getLead(tx, viewer('owner'), lead.made), [ids.ws], B)).toBeNull();
    await expect(inWs((tx) => getLead(tx, viewer('support'), lead.made))).rejects.toThrow(
      LeadAccessDeniedError,
    );
  });

  it('gives at most 500 events, and says it cut the rest', async () => {
    await admin.query(
      `INSERT INTO lead_events (id, org_id, workspace_id, lead_id, type, actor_user_id)
       SELECT unnest($5::uuid[]), $1, $2, $3, 'owner_changed', $4`,
      [A, ids.ws, lead.older, people.other, Array.from({ length: 501 }, () => uuidv7())],
    );
    const detail = await inWs((tx) => getLead(tx, viewer('owner', seedUsers.get(A)), lead.older));
    expect([detail?.events.length, detail?.eventsCapped]).toEqual([500, true]);
  });
});

describe('readPipeline', () => {
  it('gives the steps of a workspace in order and its reasons to lose in force; Support throws', async () => {
    const pipeline = (ws: string, role: OrgRole = 'viewer') =>
      inWs((tx) => readPipeline(tx, viewer(role), ws), [ids.ws, ids.ws2]);
    expect(await pipeline(ids.ws)).toEqual({
      stages: [
        { id: ids.stage, name: 'Seed', position: 0 },
        { id: ids.stage2, name: 'Bước 2', position: 1 },
      ],
      lostReasons: ['Seed'],
    });
    expect(await pipeline(ids.ws2)).toEqual({
      stages: [{ id: ids.stageWs2, name: 'Bước 1', position: 0 }],
      lostReasons: [],
    });
    await expect(pipeline(ids.ws, 'support')).rejects.toThrow(LeadAccessDeniedError);
  });
});
