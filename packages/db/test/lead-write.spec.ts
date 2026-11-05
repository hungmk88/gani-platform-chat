import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDbPool,
  createLead,
  InvalidLeadOwnerError,
  InvalidLeadStageError,
  LeadAccessDeniedError,
  LeadPipelineMissingError,
  LeadReferenceNotFoundError,
  withTenant,
  type LeadCreate,
  type LeadViewer,
  type OrgRole,
  type TenantTx,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Making leads (L3a-2; G1–G3, N188, N196) as app_role through RLS: who may, which step and which owner, and the created event written
// in the same transaction. Moving and closing come in L3b.
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
