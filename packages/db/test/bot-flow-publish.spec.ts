import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BotGraph,
  BotFlowNotFoundError,
  BotGraphInvalidError,
  createBotFlow,
  createDbPool,
  listBotFlows,
  loadBotFlow,
  loadBotFlowVersion,
  publishBotFlow,
  saveBotFlowDraft,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// Publishing and listing the scripted bot flows (D1a2b, N179): the draft becomes published version max + 1 under the flow's lock, a
// new draft copies its graph, an empty draft is never published; the list holds the live flows of one workspace and organisation.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

const as = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [workspaceOf.get(org)!] }, fn);
const user = (org = A) => seedUsers.get(org)!;
const make = (name = 'Đặt hàng', org = A) =>
  as(org, (tx) =>
    createBotFlow(tx, {
      workspaceId: workspaceOf.get(org)!,
      name,
      createdBy: user(org),
      newId: uuidv7,
    }),
  );
const GRAPH: BotGraph = {
  nodes: [
    { key: 'done', type: 'end', config: {} },
    { key: 'start', type: 'trigger', config: {} },
  ],
  edges: [{ from: 'start', to: 'done', label: null }],
};
const save = (flowId: string, graph = GRAPH) =>
  as(A, (tx) => saveBotFlowDraft(tx, { flowId, graph, savedBy: user(), newId: uuidv7 }));
const publish = (flowId: string, org = A) =>
  as(org, (tx) => publishBotFlow(tx, { flowId, publishedBy: user(org), newId: uuidv7 }));
const versionsOf = async (flowId: string) =>
  (
    await admin.query<{ status: string; version: number | null }>(
      'SELECT status, version FROM bot_flow_versions WHERE flow_id = $1 ORDER BY created_at, id',
      [flowId],
    )
  ).rows.map((r) => `${r.status}:${r.version ?? '-'}`);

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

describe('bot-flow-store: publish and list', () => {
  it('publishes the draft as version 1, then 2, each time opening a new draft that copies the graph', async () => {
    const { flow } = await make();
    const saved = await save(flow.id);
    const first = await publish(flow.id);
    expect(first).toMatchObject({ versionId: saved.draftVersionId, version: 1 });
    expect(first.flow).toMatchObject({ status: 'active', version: 2 });
    const published = await as(A, (tx) => loadBotFlowVersion(tx, first.versionId));
    expect(published).toMatchObject({ status: 'published', version: 1, graph: GRAPH });
    expect(published?.publishedAt).toBeInstanceOf(Date);
    expect((await as(A, (tx) => loadBotFlowVersion(tx, first.draftVersionId)))?.graph).toEqual(
      GRAPH,
    );
    const second = await publish(flow.id);
    expect(second.version).toBe(2);
    expect(await versionsOf(flow.id)).toEqual([
      'discarded:-',
      'published:1',
      'published:2',
      'draft:-',
    ]);
    // A published version is frozen (BF001), even for its owner.
    await expect(
      admin.query(`UPDATE bot_flow_versions SET updated_at = now() WHERE id = $1`, [
        first.versionId,
      ]),
    ).rejects.toMatchObject({ code: 'BF001' });
  });

  it('never publishes an empty draft, and writes nothing then', async () => {
    const { flow } = await make();
    const error = await publish(flow.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BotGraphInvalidError);
    expect((error as BotGraphInvalidError).problem).toBe('trigger_count');
    expect(await versionsOf(flow.id)).toEqual(['draft:-']);
    const [row] = (
      await admin.query<{ status: string; version: number }>(
        'SELECT status, version FROM bot_flows WHERE id = $1',
        [flow.id],
      )
    ).rows;
    expect(row).toEqual({ status: 'draft', version: 0 });
  });

  it('numbers two publishes that race one after the other, under the flow lock', async () => {
    const { flow } = await make();
    await save(flow.id);
    let second: ReturnType<typeof publish> | undefined;
    await as(A, async (tx) => {
      await publishBotFlow(tx, { flowId: flow.id, publishedBy: user(), newId: uuidv7 });
      second = publish(flow.id);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect((await second!).version).toBe(2);
    expect(await versionsOf(flow.id)).toEqual([
      'discarded:-',
      'published:1',
      'published:2',
      'draft:-',
    ]);
  });

  it('lists the live flows of a workspace with their latest published version, nothing of another organisation', async () => {
    const [never, live, gone] = [
      await make('Chưa xuất bản'),
      await make('Đang chạy'),
      await make('Đã xóa'),
    ];
    await save(live.flow.id);
    await publish(live.flow.id);
    await admin.query('UPDATE bot_flows SET deleted_at = now() WHERE id = $1', [gone.flow.id]);
    const theirs = await make('Của B', B);
    const list = await as(A, (tx) => listBotFlows(tx, { workspaceId: workspaceOf.get(A)! }));
    const ids = list.map((f) => f.id);
    expect(ids).toContain(never.flow.id);
    expect(ids).not.toContain(gone.flow.id);
    expect(ids).not.toContain(theirs.flow.id);
    expect(list.find((f) => f.id === live.flow.id)).toMatchObject({
      status: 'active',
      publishedVersion: 1,
    });
    expect(list.find((f) => f.id === never.flow.id)?.publishedVersion).toBeNull();
    // Last changed first: the flow just published comes before the one made before it.
    expect(ids.indexOf(live.flow.id)).toBeLessThan(ids.indexOf(never.flow.id));
    await expect(publish(live.flow.id, B)).rejects.toBeInstanceOf(BotFlowNotFoundError);
  });

  it('loads a live flow with its draft and its latest published version, nothing of another organisation', async () => {
    const { flow, draftVersionId } = await make();
    expect(await as(A, (tx) => loadBotFlow(tx, flow.id))).toMatchObject({
      id: flow.id,
      draftVersionId,
      publishedVersionId: null,
    });
    await save(flow.id);
    const first = await publish(flow.id);
    const second = await publish(flow.id);
    expect(await as(A, (tx) => loadBotFlow(tx, flow.id))).toMatchObject({
      status: 'active',
      draftVersionId: second.draftVersionId,
      publishedVersionId: second.versionId,
    });
    expect(first.versionId).not.toBe(second.versionId);
    expect(await as(B, (tx) => loadBotFlow(tx, flow.id))).toBeNull();
    await admin.query('UPDATE bot_flows SET deleted_at = now() WHERE id = $1', [flow.id]);
    expect(await as(A, (tx) => loadBotFlow(tx, flow.id))).toBeNull();
  });
});
