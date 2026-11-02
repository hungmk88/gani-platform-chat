import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import {
  createBotFlow,
  createDbPool,
  publishBotFlow,
  saveBotFlowDraft,
  withTenant,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// /v1/bot-flows (D1a3a and D1a3b, U63) over HTTP with the whole application and PostgreSQL. Org A: an owner (with a second factor), a manager, a
// sales and a marketing, all in workspace W; W2 has nobody of them but a flow. Org B: a workspace.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, W2, WB, inW2] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(role: string, hash: string) {
  const id = (people[role] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), orgA, id, role]);
  await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [randomUUID(), orgA, W, id]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  if (role === 'owner') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
type Answer = { status: number; body: Record<string, unknown> };
async function call(who: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await fetch(`${url}/v1/bot-flows${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookies[who] ?? '',
      origin: ORIGIN,
      ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $4, 'ww', 'W', 'service'), ($2, $4, 'w2', 'W2', 'service'), ($3, $5, 'wb', 'WB', 'service')`, [W, W2, WB, orgA, orgB]);
  await q(`INSERT INTO bot_flows (id, org_id, workspace_id, name) VALUES ($1, $2, $3, 'Ở W2')`, [inW2, orgA, W2]);
  await q(`INSERT INTO bot_flow_versions (id, org_id, flow_id) VALUES ($1, $2, $3)`, [randomUUID(), orgA, inW2]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'manager', 'sales', 'marketing']) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  // The graph of a published or discarded version never goes (BF001): the owner turns the guard off for this test's rows only.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    for (const t of ['bot_edges', 'bot_nodes', 'bot_flow_versions']) {
      await client.query(`ALTER TABLE ${t} DISABLE TRIGGER ${t}_guard`);
      await client.query(`DELETE FROM ${t} WHERE org_id = ANY($1::uuid[])`, [[orgA, orgB]]);
      await client.query(`ALTER TABLE ${t} ENABLE TRIGGER ${t}_guard`);
    }
    await client.query('DELETE FROM bot_flows WHERE org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  for (const [text, ids] of [
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['audit_logs WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

const GRAPH = {
  nodes: [
    { key: 'done', type: 'end' as const, config: {} },
    { key: 'start', type: 'trigger' as const, config: { on: 'keyword', keywords: ['giá'] } },
  ],
  edges: [{ from: 'start', to: 'done', label: null }],
};

describe('/v1/bot-flows', () => {
  it('lets a Manager make a flow, find it in the list and read it with its empty draft', async () => {
    const made = await call('manager', 'POST', '', { workspaceId: W, name: ' Báo giá ' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      workspaceId: W,
      name: 'Báo giá',
      status: 'draft',
      version: 0,
      publishedVersion: null,
      draft: { status: 'draft', version: null, publishedAt: null, graph: { nodes: [], edges: [] } },
      published: null,
    });
    const list = await call('owner', 'GET', `?workspaceId=${W}`);
    expect(list.status).toBe(200);
    expect(list.body['data']).toEqual([
      expect.objectContaining({ id: made.body['id'], publishedVersion: null }),
    ]);
    expect((await call('owner', 'GET', `/${String(made.body['id'])}`)).body).toEqual(made.body);
  });

  it('reads the graph of the draft and of the latest published version', async () => {
    const app = createDbPool(need('DATABASE_URL_APP'), { max: 1 });
    const id = await withTenant(app, { orgId: orgA, workspaceIds: [W] }, async (tx) => {
      const { flow } = await createBotFlow(tx, {
        workspaceId: W,
        name: 'Đơn',
        createdBy: people['owner']!,
        newId: uuidv7,
      });
      await saveBotFlowDraft(tx, {
        flowId: flow.id,
        graph: GRAPH,
        savedBy: people['owner']!,
        newId: uuidv7,
      });
      await publishBotFlow(tx, { flowId: flow.id, publishedBy: people['owner']!, newId: uuidv7 });
      return flow.id;
    });
    await app.end();
    const read = await call('manager', 'GET', `/${id}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      status: 'active',
      publishedVersion: 1,
      draft: { status: 'draft', graph: GRAPH },
    });
    expect(read.body['published']).toMatchObject({ status: 'published', version: 1, graph: GRAPH });
  });

  it('refuses other roles (403), other workspaces and organisations (404), and a bad request (400)', async () => {
    for (const [method, path, body] of [
      ['GET', `?workspaceId=${W}`],
      ['POST', '', { workspaceId: W, name: 'X' }],
      ['GET', `/${inW2}`],
    ] as const)
      for (const who of ['sales', 'marketing'])
        expect((await call(who, method, path, body)).status).toBe(403);
    expect((await call('manager', 'GET', `?workspaceId=${W2}`)).status).toBe(404);
    expect((await call('manager', 'GET', `?workspaceId=${WB}`)).status).toBe(404);
    expect((await call('manager', 'POST', '', { workspaceId: WB, name: 'X' })).status).toBe(404);
    expect((await call('manager', 'GET', `/${inW2}`)).status).toBe(404);
    expect((await call('manager', 'GET', `/${randomUUID()}`)).status).toBe(404);
    expect((await call('manager', 'GET', '/not-a-uuid')).status).toBe(400);
    expect((await call('manager', 'GET', `?workspaceId=${W}&orgId=${orgB}`)).status).toBe(400);
    for (const bad of [
      { workspaceId: W, name: '  ' },
      { workspaceId: W, name: 'X', orgId: orgB },
      { workspaceId: W },
    ])
      expect((await call('manager', 'POST', '', bad)).status).toBe(400);
  });

  it('saves a draft, refuses a node of Đợt 2 (400) and a graph that cannot run (422), publishes and audits it', async () => {
    const id = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Lưu' })).body['id'],
    );
    expect((await call('manager', 'POST', `/${id}/versions`)).body).toMatchObject({
      status: 422,
      code: 'bot_flow_graph_invalid',
    });
    const saved = await call('manager', 'PUT', `/${id}/draft`, GRAPH);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      version: 1,
      draft: { status: 'draft', graph: GRAPH },
      published: null,
    });
    const ai = { ...GRAPH, nodes: [...GRAPH.nodes, { key: 'ai', type: 'ai_answer', config: {} }] };
    expect((await call('manager', 'PUT', `/${id}/draft`, ai)).status).toBe(400);
    const extra = {
      ...GRAPH,
      nodes: [{ key: 'done', type: 'end', config: { x: 1 } }, GRAPH.nodes[1]],
    };
    expect((await call('manager', 'PUT', `/${id}/draft`, extra)).status).toBe(400);
    const two = {
      nodes: [...GRAPH.nodes, { key: 's2', type: 'trigger', config: { on: 'first_message' } }],
      edges: [],
    };
    const refused = await call('manager', 'PUT', `/${id}/draft`, two);
    expect(refused.body).toMatchObject({ status: 422, code: 'bot_flow_graph_invalid' });
    expect(String(refused.body['detail'])).toContain('trigger_count');
    const first = await call('owner', 'POST', `/${id}/versions`);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: 'active',
      publishedVersion: 1,
      published: { version: 1, graph: GRAPH },
    });
    expect((await call('owner', 'POST', `/${id}/versions`)).body).toMatchObject({
      publishedVersion: 2,
    });
    const { rows } = await q(
      `SELECT action, actor_user_id, detail FROM audit_logs WHERE org_id = $1 AND target_id = $2 ORDER BY created_at, id`,
      [orgA, id],
    );
    expect(rows).toEqual([
      { action: 'bot_flow.published', actor_user_id: people['owner'], detail: { version: 1 } },
      { action: 'bot_flow.published', actor_user_id: people['owner'], detail: { version: 2 } },
    ]);
  });

  it('deletes a flow (soft, audited), after which it is gone from the list and from every path', async () => {
    const id = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Xóa' })).body['id'],
    );
    expect((await call('manager', 'DELETE', `/${id}`)).status).toBe(204);
    const { rows } = await q(
      `SELECT action, detail FROM audit_logs WHERE org_id = $1 AND target_id = $2`,
      [orgA, id],
    );
    expect(rows).toEqual([{ action: 'bot_flow.deleted', detail: {} }]);
    expect((await call('manager', 'GET', `?workspaceId=${W}`)).body['data']).not.toContainEqual(
      expect.objectContaining({ id }),
    );
    for (const [method, path, body] of [
      ['GET', `/${id}`],
      ['DELETE', `/${id}`],
      ['PUT', `/${id}/draft`, GRAPH],
      ['POST', `/${id}/versions`],
    ] as const)
      expect((await call('manager', method, path, body)).status).toBe(404);
  });

  it('keeps the writes to builders of the session’s workspaces', async () => {
    const id = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Quyền' })).body['id'],
    );
    const writes = (flow: string) =>
      [
        ['PUT', `/${flow}/draft`, GRAPH],
        ['POST', `/${flow}/versions`],
        ['DELETE', `/${flow}`],
      ] as const;
    for (const [method, path, body] of writes(id))
      expect((await call('sales', method, path, body)).status).toBe(403);
    // Publishing makes data: without its Idempotency-Key it is a 400 (N134), and nothing is published.
    const bare = await fetch(`${url}/v1/bot-flows/${id}/versions`, {
      method: 'POST',
      headers: { cookie: cookies['manager'] ?? '', origin: ORIGIN },
    });
    expect(bare.status).toBe(400);
    for (const [method, path, body] of writes(inW2))
      expect((await call('manager', method, path, body)).status).toBe(404);
  });
});

// D1d: the dry-run. The published version and the draft of one flow answer the same script differently; nothing is written.
// prettier-ignore
const node = (key: string, type: string, config: Record<string, unknown> = {}) => ({ key, type, config });
// prettier-ignore
const ASK = node('pack', 'question', { text: 'Loại?', kind: 'choice', choices: ['Hộp', 'Thùng'], variable: 'pack' });
// prettier-ignore
const V1 = {
  nodes: [node('start', 'trigger', { on: 'keyword', keywords: ['giá'] }), node('hi', 'message', { text: 'Chào {{customer.name}}' }), ASK, node('done', 'end')],
  edges: [{ from: 'start', to: 'hi', label: null }, { from: 'hi', to: 'pack', label: null }, { from: 'pack', to: 'done', label: null }],
};
// prettier-ignore
const V2 = {
  nodes: [node('start', 'trigger', { on: 'keyword', keywords: ['giá'] }), ASK, node('done', 'end'), node('human', 'handoff', { reason: 'big_order', priority: 'high' })],
  edges: [{ from: 'start', to: 'pack', label: null }, { from: 'pack', to: 'human', label: 'Thùng' }, { from: 'pack', to: 'done', label: null }],
};
const WRITTEN = [
  'messages',
  'message_deliveries',
  'bot_sessions',
  'bot_session_steps',
  'conversation_events',
  'audit_logs',
];
const written = async () => {
  const counts: Record<string, number> = {};
  for (const t of WRITTEN)
    counts[t] = Number(
      (
        (await q(`SELECT count(*) AS n FROM ${t} WHERE org_id = $1`, [orgA])).rows[0] as {
          n: string;
        }
      ).n,
    );
  return counts;
};

describe('POST /v1/bot-flows/{id}/dry-run', () => {
  it('runs the same script on the published version and on the draft, and writes nothing', async () => {
    const id = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Chạy thử' })).body['id'],
    );
    expect((await call('manager', 'PUT', `/${id}/draft`, V1)).status).toBe(200);
    expect((await call('manager', 'POST', `/${id}/versions`)).status).toBe(201);
    expect((await call('manager', 'PUT', `/${id}/draft`, V2)).status).toBe(200);
    const before = await written();
    const script = { messages: ['Giá bao nhiêu?', 'Thùng', 'còn nữa'], customerName: 'Lan' };
    const published = await call('manager', 'POST', `/${id}/dry-run`, {
      ...script,
      version: 'published',
    });
    expect(published.status).toBe(200);
    expect(published.body).toEqual({
      flowId: id,
      version: { id: expect.any(String) as unknown, kind: 'published', number: 1 },
      triggerMatched: true,
      businessHoursAssumed: true,
      status: 'completed',
      error: null,
      turns: [
        {
          replies: [
            { nodeKey: 'hi', text: 'Chào Lan' },
            { nodeKey: 'pack', text: 'Loại?\n1. Hộp\n2. Thùng' },
          ],
          steps: [
            { nodeKey: 'start', nodeType: 'trigger' },
            { nodeKey: 'hi', nodeType: 'message' },
            { nodeKey: 'pack', nodeType: 'question' },
          ],
          handoff: null,
        },
        {
          replies: [],
          steps: [
            { nodeKey: 'pack', nodeType: 'question', variable: 'pack' },
            { nodeKey: 'done', nodeType: 'end' },
          ],
          handoff: null,
        },
      ],
      vars: { pack: 'Thùng' },
      unusedMessages: 1,
    });
    const draft = await call('owner', 'POST', `/${id}/dry-run`, script);
    expect(draft.body).toMatchObject({
      version: { kind: 'draft', number: null },
      status: 'handed_off',
      error: null,
      unusedMessages: 1,
    });
    const turns = draft.body['turns'] as { handoff: unknown; steps: { edgeLabel?: string }[] }[];
    expect(turns[1]).toMatchObject({ handoff: { reason: 'big_order', priority: 'high' } });
    expect(turns[1]!.steps[0]).toMatchObject({ edgeLabel: 'Thùng' });
    // The first message decides only triggerMatched: the run starts the flow either way.
    expect(
      (await call('manager', 'POST', `/${id}/dry-run`, { messages: ['xin chào'] })).body,
    ).toMatchObject({
      triggerMatched: false,
      status: 'active',
    });
    expect(await written()).toEqual(before);
  });

  it('answers a flow that cannot run with a 200, its code and no detail of the server', async () => {
    const id = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Gãy' })).body['id'],
    );
    const jump = {
      nodes: [
        node('start', 'trigger', { on: 'first_message' }),
        node('go', 'jump_to_flow', { flowId: randomUUID() }),
      ],
      edges: [{ from: 'start', to: 'go', label: null }],
    };
    expect((await call('manager', 'PUT', `/${id}/draft`, jump)).status).toBe(200);
    const broken = await call('manager', 'POST', `/${id}/dry-run`, { messages: ['a', 'b'] });
    expect(broken.status).toBe(200);
    expect(broken.body).toMatchObject({
      triggerMatched: true,
      status: 'abandoned',
      error: 'jump_target',
      unusedMessages: 1,
      turns: [{ replies: [], handoff: { reason: 'jump_target', priority: 'normal' } }],
    });
    const empty = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Rỗng' })).body['id'],
    );
    expect(
      (await call('manager', 'POST', `/${empty}/dry-run`, { messages: ['a'] })).body,
    ).toMatchObject({
      triggerMatched: false,
      status: 'abandoned',
      error: 'no_trigger',
    });
    // Never published: no published version to run.
    expect(
      (
        await call('manager', 'POST', `/${empty}/dry-run`, {
          messages: ['a'],
          version: 'published',
        })
      ).body,
    ).toMatchObject({
      status: 422,
      code: 'bot_flow_not_published',
    });
  });

  it('refuses other roles (403), a flow of another workspace or organisation (404) and a bad script (400)', async () => {
    const id = String(
      (await call('manager', 'POST', '', { workspaceId: W, name: 'Quyền thử' })).body['id'],
    );
    const inB = randomUUID();
    await q(`INSERT INTO bot_flows (id, org_id, workspace_id, name) VALUES ($1, $2, $3, 'Ở B')`, [
      inB,
      orgB,
      WB,
    ]);
    await q(`INSERT INTO bot_flow_versions (id, org_id, flow_id) VALUES ($1, $2, $3)`, [
      randomUUID(),
      orgB,
      inB,
    ]);
    const ok = { messages: ['a'] };
    for (const who of ['sales', 'marketing'])
      expect((await call(who, 'POST', `/${id}/dry-run`, ok)).status).toBe(403);
    for (const flow of [inW2, inB, randomUUID()])
      expect((await call('manager', 'POST', `/${flow}/dry-run`, ok)).status).toBe(404);
    for (const bad of [
      { messages: [] },
      { messages: Array.from({ length: 21 }, () => 'a') },
      { messages: ['a'.repeat(1001)] },
      { messages: ['  '] },
      { messages: ['a'], version: 'v1' },
      { messages: ['a'], customerName: 'x'.repeat(101) },
      { messages: ['a'], orgId: orgB },
    ])
      expect((await call('manager', 'POST', `/${id}/dry-run`, bad)).status).toBe(400);
    expect((await call('manager', 'POST', '/not-a-uuid/dry-run', ok)).status).toBe(400);
  });
});
