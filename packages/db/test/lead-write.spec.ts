import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  changeLeadStage,
  closeLead,
  createDbPool,
  createLead,
  InvalidLeadOwnerError,
  InvalidLeadStageError,
  InvalidLostReasonError,
  LeadAccessDeniedError,
  LeadClosedError,
  LeadPipelineMissingError,
  LeadReferenceNotFoundError,
  LeadVersionConflictError,
  withTenant,
  type LeadCreate,
  type LeadViewer,
  type OrgRole,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Making, moving and closing leads (L3a-2, L3b; G1–G3, T-3, N188, N196) as app_role through RLS: who may, which step and which owner,
// the version, and the event written with each change in the same transaction.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
// `away` is a Sales of the organisation who is not a member of the workspace; `helper` a Support who is.
const people = {
  sales: uuidv7(),
  manager: uuidv7(),
  marketing: uuidv7(),
  helper: uuidv7(),
  away: uuidv7(),
};
const ids = {
  ws: '',
  ws2: '',
  ws3: '',
  stage: '',
  stage2: '',
  stageWs2: '',
  customer: '',
  customerB: '',
};
let admin: pg.Client;
let pool: pg.Pool;

const as = (role: OrgRole, userId: string): LeadViewer => ({ role, userId });
const sales = () => as('sales', people.sales);
const manager = () => as('manager', people.manager);
const inWs = <T>(fn: (tx: TenantTx) => Promise<T>, workspaces = [ids.ws]) =>
  withTenant(pool, { orgId: A, workspaceIds: workspaces }, fn);
const create = (v: LeadViewer, input: Partial<LeadCreate> = {}, workspaces = [ids.ws]) =>
  inWs(
    (tx) =>
      createLead(tx, v, {
        workspaceId: ids.ws,
        customerId: ids.customer,
        title: 'Báo giá',
        newId: uuidv7,
        ...input,
      }),
    workspaces,
  );
const move = (v: LeadViewer, id: string, stageId: string, version = 0) =>
  inWs((tx) => changeLeadStage(tx, v, { id, stageId, version, newId: uuidv7 }));
const close = (
  v: LeadViewer,
  id: string,
  outcome: 'won' | 'lost',
  lostReason?: string,
  version = 0,
) =>
  inWs((tx) =>
    closeLead(tx, v, {
      id,
      version,
      outcome,
      newId: uuidv7,
      ...(lostReason === undefined ? {} : { lostReason }),
    }),
  );
/** A lead made straight in the database, at the first step. */
const lead = async (
  by = people.manager,
  owner: string | null = null,
  ws = ids.ws,
  stage = ids.stage,
) => {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO leads (id, org_id, workspace_id, title, customer_id, stage_id, owner_user_id, created_by)
     VALUES ($1, $2, $3, 'Báo giá', $4, $5, $6, $7)`,
    [id, A, ws, ids.customer, stage, owner, by],
  );
  return id;
};
const stored = async (id: string) =>
  (
    await admin.query<{ stage_id: string; status: string; version: number }>(
      'SELECT stage_id, status, version FROM leads WHERE id = $1',
      [id],
    )
  ).rows[0];
const events = async (id: string) =>
  (
    await admin.query<{
      type: string;
      from_stage_id: string | null;
      to_stage_id: string | null;
      outcome: string | null;
      actor_user_id: string;
    }>(
      'SELECT type, from_stage_id, to_stage_id, outcome, actor_user_id FROM lead_events WHERE lead_id = $1 ORDER BY occurred_at, id',
      [id],
    )
  ).rows;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) seedUsers.set(org, await seedTenant(admin, org));
  const one = async (sql: string, org = A) =>
    (await admin.query<{ id: string }>(sql, [org])).rows[0]?.id as string;
  ids.ws = await one('SELECT id FROM workspaces WHERE org_id = $1');
  ids.stage = await one('SELECT id FROM pipeline_stages WHERE org_id = $1');
  ids.customer = await one('SELECT id FROM customers WHERE org_id = $1');
  ids.customerB = await one('SELECT id FROM customers WHERE org_id = $1', B);
  [ids.ws2, ids.ws3, ids.stage2, ids.stageWs2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const roles: Record<keyof typeof people, OrgRole> = {
    sales: 'sales',
    manager: 'manager',
    marketing: 'marketing',
    helper: 'support',
    away: 'sales',
  };
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $3, 'ws2', 'W2', 'service'), ($2, $3, 'ws3', 'W3', 'service')`,
    [ids.ws2, ids.ws3, A],
  );
  for (const [key, id] of Object.entries(people) as [keyof typeof people, string][]) {
    await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
      id,
      `${id}@example.test`,
    ]);
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`,
      [uuidv7(), A, id, roles[key]],
    );
    if (key !== 'away')
      await admin.query(
        'INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)',
        [uuidv7(), A, ids.ws, id],
      );
  }
  await admin.query(
    `INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'Bước 2', 1), ($4, $2, $5, 'Bước 1', 0)`,
    [ids.stage2, A, ids.ws, ids.stageWs2, ids.ws2],
  );
});

afterAll(async () => {
  await pool.end();
  await admin.query('DELETE FROM lead_events WHERE org_id = $1', [A]);
  await admin.query('DELETE FROM leads WHERE org_id = $1', [A]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(people)]);
  await admin.end();
});

describe('createLead', () => {
  it('makes an open lead at the first step, the title trimmed and in NFC, with its created event', async () => {
    const row = await create(manager(), { title: '  Báo giá ', ownerUserId: people.sales });
    expect(row).toMatchObject({
      title: 'Báo giá',
      status: 'open',
      stageId: ids.stage,
      stageName: 'Seed',
      ownerUserId: people.sales,
      createdBy: people.manager,
      version: 0,
    });
    expect(await events(row.id)).toEqual([
      {
        type: 'created',
        from_stage_id: null,
        to_stage_id: ids.stage,
        outcome: null,
        actor_user_id: people.manager,
      },
    ]);
    expect((await create(sales(), { stageId: ids.stage2 })).stageId).toBe(ids.stage2);
  });

  it('refuses a step, an owner, a customer or a conversation that is not the workspace’s, and a role that may not make one', async () => {
    await expect(create(manager(), { stageId: ids.stageWs2 })).rejects.toThrow(
      InvalidLeadStageError,
    );
    for (const owner of [people.helper, people.away, people.marketing])
      await expect(create(manager(), { ownerUserId: owner })).rejects.toThrow(
        InvalidLeadOwnerError,
      );
    await expect(create(manager(), { customerId: ids.customerB })).rejects.toThrow(
      LeadReferenceNotFoundError,
    );
    await expect(create(manager(), { conversationId: uuidv7() })).rejects.toThrow(
      LeadReferenceNotFoundError,
    );
    for (const role of ['marketing', 'viewer', 'support'] as const)
      await expect(create(as(role, people.manager))).rejects.toThrow(LeadAccessDeniedError);
    await expect(create(manager(), { workspaceId: ids.ws3 }, [ids.ws3])).rejects.toThrow(
      LeadPipelineMissingError,
    );
  });
});

describe('changeLeadStage', () => {
  it('moves an open lead either way with a stage_changed event, one version at a time', async () => {
    const id = await lead();
    expect(await move(manager(), id, ids.stage2)).toMatchObject({
      stageId: ids.stage2,
      stageName: 'Bước 2',
      version: 1,
    });
    expect((await move(manager(), id, ids.stage, 1))?.version).toBe(2);
    expect(
      (await events(id)).map((e) => [e.type, e.from_stage_id, e.to_stage_id, e.actor_user_id]),
    ).toEqual([
      ['stage_changed', ids.stage, ids.stage2, people.manager],
      ['stage_changed', ids.stage2, ids.stage, people.manager],
    ]);
  });

  it('refuses the step it is at or another workspace’s, and a stale version, writing nothing', async () => {
    const id = await lead();
    await expect(move(manager(), id, ids.stage)).rejects.toThrow(InvalidLeadStageError);
    await expect(move(manager(), id, ids.stageWs2)).rejects.toThrow(InvalidLeadStageError);
    await expect(move(manager(), id, ids.stage2, 3)).rejects.toThrow(LeadVersionConflictError);
    expect(await stored(id)).toEqual({ stage_id: ids.stage, status: 'open', version: 0 });
    expect(await events(id)).toEqual([]);
  });

  it('lets a Sales move the leads they made or own and no other (not found), and refuses a reader or Support', async () => {
    expect(await move(sales(), await lead(people.sales), ids.stage2)).not.toBeNull();
    expect(
      await move(sales(), await lead(people.manager, people.sales), ids.stage2),
    ).not.toBeNull();
    const theirs = await lead(people.manager, people.manager);
    expect(await move(sales(), theirs, ids.stage2)).toBeNull();
    for (const role of ['marketing', 'viewer', 'support'] as const)
      await expect(move(as(role, people.marketing), theirs, ids.stage2)).rejects.toThrow(
        LeadAccessDeniedError,
      );
    expect(
      await move(manager(), await lead(people.manager, null, ids.ws2, ids.stageWs2), ids.stage2),
    ).toBeNull();
    expect(await stored(theirs)).toEqual({ stage_id: ids.stage, status: 'open', version: 0 });
  });
});

describe('closeLead', () => {
  it('wins a lead for good, with a closed event that has the outcome and no reason', async () => {
    const id = await lead();
    expect(await close(manager(), id, 'won')).toMatchObject({
      status: 'won',
      lostReason: null,
      version: 1,
    });
    expect((await events(id)).map((e) => [e.type, e.outcome, e.to_stage_id])).toEqual([
      ['closed', 'won', null],
    ]);
    await expect(close(manager(), id, 'lost', 'Seed', 1)).rejects.toThrow(LeadClosedError);
    await expect(move(manager(), id, ids.stage2, 1)).rejects.toThrow(LeadClosedError);
  });

  it('loses a lead only with a reason in force, audits the outcome alone, and a Sales closes only their own', async () => {
    const id = await lead(people.sales);
    await expect(close(sales(), id, 'lost', 'Không có')).rejects.toThrow(InvalidLostReasonError);
    await expect(close(sales(), id, 'lost')).rejects.toThrow(RangeError);
    await expect(close(sales(), id, 'won', 'Seed')).rejects.toThrow(RangeError);
    expect(await stored(id)).toEqual({ stage_id: ids.stage, status: 'open', version: 0 });
    const row = await close(sales(), id, 'lost', ' Seed ');
    expect(row).toMatchObject({ status: 'lost', lostReason: 'Seed', version: 1 });
    expect(row?.closedAt).toBeInstanceOf(Date);
    // The audit row has the outcome only: no reason, no title.
    const audit = await admin.query(
      `SELECT actor_user_id, action, target_type, detail FROM audit_logs WHERE target_id = $1`,
      [id],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: people.sales,
        action: 'lead.closed',
        target_type: 'lead',
        detail: { outcome: 'lost' },
      },
    ]);
    expect(await close(sales(), await lead(), 'won')).toBeNull();
  });
});
