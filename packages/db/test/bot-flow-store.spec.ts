import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BotGraph,
  BotFlowNotFoundError,
  BotGraphInvalidError,
  botGraphProblem,
  createBotFlow,
  createDbPool,
  loadBotFlowVersion,
  saveBotFlowDraft,
  withTenant,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The store of the scripted bot flows (D1a2a, N178): a flow starts with an empty draft, saving a draft gives the old one up and writes
// the whole graph as a new version, under the flow's lock; a graph is checked before anything is written; RLS keeps each organisation
// to its own flows.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let admin: pg.Client;
let pool: pg.Pool;

const as = <T>(org: string, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: org, workspaceIds: [workspaceOf.get(org)!] }, fn);
const make = (org = A) =>
  as(org, (tx) =>
    createBotFlow(tx, {
      workspaceId: workspaceOf.get(org)!,
      name: 'Đặt hàng',
      createdBy: seedUsers.get(org)!,
      newId: uuidv7,
    }),
  );
const save = (flowId: string, graph: BotGraph, org = A) =>
  as(org, (tx) =>
    saveBotFlowDraft(tx, { flowId, graph, savedBy: seedUsers.get(org)!, newId: uuidv7 }),
  );
const load = (id: string, org = A) => as(org, (tx) => loadBotFlowVersion(tx, id));
const versionsOf = async (flowId: string) =>
  (
    await admin.query<{ status: string }>(
      'SELECT status FROM bot_flow_versions WHERE flow_id = $1 ORDER BY created_at, id',
      [flowId],
    )
  ).rows.map((r) => r.status);

const node = (key: string, type: BotGraph['nodes'][number]['type'] = 'message', config = {}) => ({
  key,
  type,
  config,
});
const edge = (from: string, to: string, label: string | null = null) => ({ from, to, label });
const GRAPH: BotGraph = {
  nodes: [
    node('start', 'trigger', { on: 'first_message' }),
    node('ask', 'question', { kind: 'choice' }),
    node('done', 'end'),
    node('human', 'handoff'),
  ],
  edges: [edge('start', 'ask'), edge('ask', 'done', 'Có'), edge('ask', 'human', 'Không')],
};

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

describe('bot-flow-store', () => {
  it('makes a flow with an empty draft, then saves a graph as a new draft and gives the old one up', async () => {
    const { flow, draftVersionId: empty } = await make();
    expect(flow).toMatchObject({
      workspaceId: workspaceOf.get(A),
      name: 'Đặt hàng',
      status: 'draft',
      version: 0,
    });
    expect(await load(empty)).toMatchObject({
      flowId: flow.id,
      status: 'draft',
      version: null,
      graph: { nodes: [], edges: [] },
    });
    const first = await save(flow.id, GRAPH);
    expect(first.flow.version).toBe(1);
    const saved = await load(first.draftVersionId);
    expect(saved?.status).toBe('draft');
    expect(saved?.graph.nodes.map((n) => n.key)).toEqual(['ask', 'done', 'human', 'start']);
    expect(saved?.graph.nodes.find((n) => n.key === 'start')).toEqual(GRAPH.nodes[0]);
    expect(saved?.graph.edges).toEqual([
      edge('ask', 'done', 'Có'),
      edge('ask', 'human', 'Không'),
      edge('start', 'ask'),
    ]);
    const second = await save(flow.id, { nodes: [node('start', 'trigger')], edges: [] });
    expect(second.flow.version).toBe(2);
    expect(await versionsOf(flow.id)).toEqual(['discarded', 'discarded', 'draft']);
    // A draft given up keeps its graph, frozen (BF001).
    expect((await load(first.draftVersionId))?.graph.nodes).toHaveLength(4);
    expect((await load(first.draftVersionId))?.status).toBe('discarded');
  });

  it('refuses a graph that breaks a rule before anything is written', async () => {
    const { flow } = await make();
    const cases: [BotGraph, string][] = [
      [{ nodes: [node('a')], edges: [] }, 'trigger_count'],
      [
        { nodes: [node('s', 'trigger'), node('t', 'trigger')], edges: [edge('s', 't')] },
        'trigger_count',
      ],
      [{ nodes: [node('s', 'trigger'), node('s')], edges: [] }, 'duplicate_key'],
      [{ nodes: [node('s', 'trigger')], edges: [edge('s', 'nowhere')] }, 'unknown_node'],
      [{ nodes: [node('s', 'trigger')], edges: [edge('nowhere', 's')] }, 'unknown_node'],
      [{ nodes: [node('s', 'trigger'), node('lost')], edges: [] }, 'unreachable_node'],
      // A loop with edges in, cut off from the trigger.
      [
        {
          nodes: [node('s', 'trigger'), node('x'), node('y')],
          edges: [edge('x', 'y'), edge('y', 'x')],
        },
        'unreachable_node',
      ],
    ];
    for (const [graph, problem] of cases) {
      expect(botGraphProblem(graph)).toBe(problem);
      const error = await save(flow.id, graph).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BotGraphInvalidError);
      expect((error as BotGraphInvalidError).problem).toBe(problem);
    }
    expect(botGraphProblem(GRAPH)).toBeNull();
    // A loop back to a node already reached is fine.
    expect(
      botGraphProblem({
        nodes: [node('s', 'trigger'), node('q')],
        edges: [edge('s', 'q'), edge('q', 'q')],
      }),
    ).toBeNull();
    expect(await versionsOf(flow.id)).toEqual(['draft']);
  });

  it('saves one draft after another under the flow lock, even when two saves race', async () => {
    const { flow } = await make();
    // The second save starts while the first is still open: it waits for the flow's lock, then gives the first's draft up.
    let second: ReturnType<typeof save> | undefined;
    await as(A, async (tx) => {
      await saveBotFlowDraft(tx, {
        flowId: flow.id,
        graph: GRAPH,
        savedBy: seedUsers.get(A)!,
        newId: uuidv7,
      });
      second = save(flow.id, GRAPH);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect((await second!).flow.version).toBe(2);
    expect(await versionsOf(flow.id)).toEqual(['discarded', 'discarded', 'draft']);
  });

  it('keeps each organisation to its own flows, and a deleted flow to nobody', async () => {
    const { flow, draftVersionId } = await make(A);
    await expect(save(flow.id, GRAPH, B)).rejects.toBeInstanceOf(BotFlowNotFoundError);
    expect(await load(draftVersionId, B)).toBeNull();
    await admin.query('UPDATE bot_flows SET deleted_at = now() WHERE id = $1', [flow.id]);
    await expect(save(flow.id, GRAPH)).rejects.toBeInstanceOf(BotFlowNotFoundError);
    expect(await versionsOf(flow.id)).toEqual(['draft']);
  });
});
