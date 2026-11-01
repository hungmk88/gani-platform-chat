import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BotGraph,
  createBotFlow,
  createDbPool,
  listBotTriggers,
  publishBotFlow,
  saveBotFlowDraft,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The flows a customer's message can start (D1b3a1, N184): the latest published version of each active, live flow of the workspace,
// with its trigger's config, the flow changed last first; nothing of another organisation.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

const as = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [workspaceOf.get(org)!] }, fn);
const graph = (trigger: Record<string, unknown>): BotGraph => ({
  nodes: [
    { key: 'start', type: 'trigger', config: trigger },
    { key: 'done', type: 'end', config: {} },
  ],
  edges: [{ from: 'start', to: 'done', label: null }],
});
async function flow(
  publishes: number,
  trigger: Record<string, unknown> = { on: 'first_message' },
  org = A,
) {
  return as(org, async (tx) => {
    const user = seedUsers.get(org)!;
    const { flow: made } = await createBotFlow(tx, {
      workspaceId: workspaceOf.get(org)!,
      name: 'F',
      createdBy: user,
      newId: uuidv7,
    });
    await saveBotFlowDraft(tx, {
      flowId: made.id,
      graph: graph(trigger),
      savedBy: user,
      newId: uuidv7,
    });
    let versionId = '';
    for (let i = 0; i < publishes; i++)
      ({ versionId } = await publishBotFlow(tx, {
        flowId: made.id,
        publishedBy: user,
        newId: uuidv7,
      }));
    return { flowId: made.id, versionId };
  });
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  for (const org of [A, B]) {
    seedUsers.set(org, await seedTenant(admin, org));
    const { rows } = await admin.query<{ id: string }>(
      'SELECT id FROM workspaces WHERE org_id = $1',
      [org],
    );
    workspaceOf.set(org, rows[0]!.id);
  }
});

afterAll(async () => {
  await pool.end();
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('listBotTriggers', () => {
  it('lists the latest published version of the active, live flows, the flow changed last first', async () => {
    const older = await flow(2);
    const newer = await flow(1, { on: 'keyword', keywords: ['giá'] });
    await flow(0);
    const off = await flow(1);
    await admin.query("UPDATE bot_flows SET status = 'inactive' WHERE id = $1", [off.flowId]);
    const gone = await flow(1);
    await admin.query('UPDATE bot_flows SET deleted_at = now() WHERE id = $1', [gone.flowId]);
    const theirs = await flow(1, { on: 'first_message' }, B);
    await admin.query("UPDATE bot_flows SET updated_at = now() + interval '1 hour' WHERE id = $1", [
      newer.flowId,
    ]);

    expect(await as(A, (tx) => listBotTriggers(tx, workspaceOf.get(A)!))).toEqual([
      {
        flowId: newer.flowId,
        versionId: newer.versionId,
        trigger: { on: 'keyword', keywords: ['giá'] },
      },
      { flowId: older.flowId, versionId: older.versionId, trigger: { on: 'first_message' } },
    ]);
    // Another organisation's workspace reads as nothing, even when named.
    expect(await as(A, (tx) => listBotTriggers(tx, workspaceOf.get(B)!))).toEqual([]);
    expect(
      (await as(B, (tx) => listBotTriggers(tx, workspaceOf.get(B)!))).map((t) => t.flowId),
    ).toEqual([theirs.flowId]);
  });
});
