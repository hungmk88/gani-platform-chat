import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asApp } from './as-app.js';
import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// bot_nodes and bot_edges (D1a1b, N177, Brief P13 and M05): RLS by organisation, an edge joins two nodes of its own version, the
// node types of Đợt 1 only (no ai_answer), and the graph of a published version or a discarded draft is never written again
// (BF001, for every role); app_role only reads and inserts. Each case uses versions of its own, written as migration_role.
const [A, B] = [uuidv7(), uuidv7()];
const seedUsers = new Map<string, string>();
const workspaceOf = new Map<string, string>();
let admin: pg.Client;
let other: pg.Client;
let app: pg.Client;

const q = (text: string, params: unknown[] = []) => admin.query(text, params);
async function version(org: string): Promise<string> {
  const [flow, id] = [uuidv7(), uuidv7()];
  await q(
    `INSERT INTO bot_flows (id, org_id, workspace_id, name) VALUES ($1, $2, $3, 'Đặt hàng')`,
    [flow, org, workspaceOf.get(org)],
  );
  // A version is written as a draft, its graph added, then published or discarded: the trigger refuses a graph written after.
  await q(`INSERT INTO bot_flow_versions (id, org_id, flow_id) VALUES ($1, $2, $3)`, [
    id,
    org,
    flow,
  ]);
  return id;
}
async function close(id: string, status: 'published' | 'discarded') {
  await q(
    `UPDATE bot_flow_versions SET status = $2, version = $3, published_at = $4 WHERE id = $1`,
    status === 'published' ? [id, status, 1, new Date()] : [id, status, null, null],
  );
}
const NODE = `INSERT INTO bot_nodes (id, org_id, version_id, key, type, config) VALUES ($1, $2, $3, $4, $5, $6)`;
const EDGE = `INSERT INTO bot_edges (id, org_id, version_id, from_node_id, to_node_id, label) VALUES ($1, $2, $3, $4, $5, $6)`;
async function node(org: string, versionId: string, key: string, type = 'message') {
  const id = uuidv7();
  await q(NODE, [id, org, versionId, key, type, {}]);
  return id;
}
async function edge(org: string, versionId: string, from: string, to: string) {
  const id = uuidv7();
  await q(EDGE, [id, org, versionId, from, to, null]);
  return id;
}
const inA = <T>(fn: () => Promise<T>) => asApp(app, A, [workspaceOf.get(A) ?? ''], fn);

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  other = new pg.Client({ connectionString: url('migration') });
  app = new pg.Client({ connectionString: url('app') });
  await Promise.all([admin.connect(), other.connect(), app.connect()]);
  for (const org of [A, B]) {
    seedUsers.set(org, await seedTenant(admin, org));
    const { rows } = await q('SELECT id FROM workspaces WHERE org_id = $1', [org]);
    workspaceOf.set(org, (rows[0] as { id: string }).id);
  }
});

afterAll(async () => {
  await Promise.all([app.end(), other.end()]);
  for (const [org, user] of seedUsers) await cleanupTenant(admin, org, user);
  await admin.end();
});

describe('bot_nodes and bot_edges', () => {
  it('keep each organisation to its own graph, and an edge to two nodes of its own version', async () => {
    const [mine, theirs] = [await version(A), await version(B)];
    const [start, end] = [
      await node(A, mine, 'start', 'trigger'),
      await node(A, mine, 'end', 'end'),
    ];
    await edge(A, mine, start, end);
    const theirStart = await node(B, theirs, 'start', 'trigger');
    await edge(B, theirs, theirStart, theirStart);
    const seen = await inA(async () => ({
      nodes: (await app.query<{ org_id: string }>('SELECT org_id FROM bot_nodes')).rows,
      edges: (await app.query<{ org_id: string }>('SELECT org_id FROM bot_edges')).rows,
    }));
    expect(seen.nodes.length).toBeGreaterThan(0);
    expect(seen.edges.length).toBeGreaterThan(0);
    expect([...seen.nodes, ...seen.edges].every((r) => r.org_id === A)).toBe(true);
    // A node in B's version under A's name: the pair (org_id, version_id) does not exist; under B's name, the policy refuses it.
    expect(await sqlState(inA(() => app.query(NODE, [uuidv7(), A, theirs, 'x', 'end', {}])))).toBe(
      '23503',
    );
    expect(await sqlState(inA(() => app.query(NODE, [uuidv7(), B, theirs, 'x', 'end', {}])))).toBe(
      '42501',
    );
    // An edge of A to a node of B, even as the owner: refused by the key (org_id, version_id, node).
    expect(await sqlState(q(EDGE, [uuidv7(), A, mine, start, theirStart, null]))).toBe('23503');
    expect(await sqlState(q(EDGE, [uuidv7(), B, theirs, theirStart, start, null]))).toBe('23503');
    // An edge between two versions of A: refused the same way.
    const next = await version(A);
    const nextStart = await node(A, next, 'start', 'trigger');
    expect(await sqlState(q(EDGE, [uuidv7(), A, next, nextStart, end, null]))).toBe('23503');
    expect(await sqlState(q(EDGE, [uuidv7(), A, mine, nextStart, end, null]))).toBe('23503');
  });

  it('let app_role write the graph of a draft, with the node types of Đợt 1 only and one trigger', async () => {
    const draft = await version(A);
    const add = (key: string, type: string, config: unknown = {}) =>
      sqlState(inA(() => app.query(NODE, [uuidv7(), A, draft, key, type, config])));
    for (const type of ['trigger', 'message', 'question', 'condition', 'set_variable', 'collect'])
      expect(await add(`n_${type}`, type)).toBeUndefined();
    for (const type of ['tag', 'api_call', 'delay', 'handoff', 'jump_to_flow', 'end'])
      expect(await add(`n_${type}`, type)).toBeUndefined();
    // ai_answer is Đợt 2 (Brief P13), wait_for_event out of scope.
    expect(await add('ai', 'ai_answer')).toBe('23514');
    expect(await add('wait', 'wait_for_event')).toBe('23514');
    expect(await add('bad key', 'end')).toBe('23514');
    expect(await add('list', 'end', '[]')).toBe('23514');
    const start = await node(A, draft, 'start', 'trigger');
    expect(await add('start_2', 'trigger')).toBe('23505');
    expect(await add('start', 'end')).toBe('23505');
    const ask = await node(A, draft, 'ask', 'question');
    const link = (label: string | null) =>
      sqlState(inA(() => app.query(EDGE, [uuidv7(), A, draft, start, ask, label])));
    expect(await link(null)).toBeUndefined();
    expect(await link('Có')).toBeUndefined();
    expect(await link(' ')).toBe('23514');
  });

  it('refuse any write to the graph of a published version or a discarded draft, for every role (BF001)', async () => {
    for (const status of ['published', 'discarded'] as const) {
      const id = await version(A);
      const [start, end] = [await node(A, id, 'start', 'trigger'), await node(A, id, 'end', 'end')];
      const link = await edge(A, id, start, end);
      await close(id, status);
      expect(await sqlState(inA(() => app.query(NODE, [uuidv7(), A, id, 'late', 'end', {}])))).toBe(
        'BF001',
      );
      expect(await sqlState(q(NODE, [uuidv7(), A, id, 'late', 'end', {}]))).toBe('BF001');
      expect(await sqlState(inA(() => app.query(EDGE, [uuidv7(), A, id, end, start, null])))).toBe(
        'BF001',
      );
      expect(await sqlState(q(EDGE, [uuidv7(), A, id, end, start, null]))).toBe('BF001');
      expect(
        await sqlState(q(`UPDATE bot_nodes SET config = '{"a": 1}' WHERE id = $1`, [end])),
      ).toBe('BF001');
      expect(await sqlState(q(`UPDATE bot_edges SET label = 'x' WHERE id = $1`, [link]))).toBe(
        'BF001',
      );
      expect(await sqlState(q('DELETE FROM bot_edges WHERE id = $1', [link]))).toBe('BF001');
      expect(await sqlState(q('DELETE FROM bot_nodes WHERE id = $1', [end]))).toBe('BF001');
    }
    // Moving a node of a draft into a published version is refused too.
    const [published, draft] = [await version(A), await version(A)];
    await close(published, 'published');
    const loose = await node(A, draft, 'loose', 'end');
    expect(
      await sqlState(q('UPDATE bot_nodes SET version_id = $2 WHERE id = $1', [loose, published])),
    ).toBe('BF001');
  });

  it('make a publish wait for a graph being written, so no node slips in after it (FOR SHARE)', async () => {
    const id = await version(A);
    await other.query('BEGIN');
    try {
      await other.query(`UPDATE bot_flow_versions SET status = 'discarded' WHERE id = $1`, [id]);
      const insert = inA(async () => {
        await app.query("SET LOCAL lock_timeout = '300ms'");
        return app.query(NODE, [uuidv7(), A, id, 'late', 'end', {}]);
      });
      expect(await sqlState(insert)).toBe('55P03');
    } finally {
      await other.query('ROLLBACK');
    }
  });

  it('give app_role no UPDATE and no DELETE, even on a draft', async () => {
    const draft = await version(A);
    const [start, end] = [
      await node(A, draft, 'start', 'trigger'),
      await node(A, draft, 'end', 'end'),
    ];
    const link = await edge(A, draft, start, end);
    for (const [sql, id] of [
      [`UPDATE bot_nodes SET config = '{}' WHERE id = $1`, end],
      ['DELETE FROM bot_nodes WHERE id = $1', end],
      [`UPDATE bot_edges SET label = 'x' WHERE id = $1`, link],
      ['DELETE FROM bot_edges WHERE id = $1', link],
    ] as const)
      expect(await sqlState(inA(() => app.query(sql, [id])))).toBe('42501');
    // The owner may still fix a draft's graph: the trigger lets a draft through.
    expect(await sqlState(q('DELETE FROM bot_edges WHERE id = $1', [link]))).toBeUndefined();
  });
});
