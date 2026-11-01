import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  advanceBotSession,
  BotSessionActiveError,
  BotSessionConflictError,
  BotVersionNotPublishedError,
  createDbPool,
  lockActiveBotSession,
  startBotSession,
  withTenant,
  type BotSessionRow,
} from '../src/index.js';
import { url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// The store of the bot sessions (D1b1b, N183): a session starts on a published version only, one active per conversation; a turn writes
// the new state, appends its steps (index after index) and keeps the last 20 on the session, under an optimistic version; RLS keeps a
// session to who sees the conversation.
const A = uuidv7();
let user = '';
let [workspace, hidden, published, draft] = ['', '', '', ''];
let admin: pg.Client;
let pool: pg.Pool;

const inWs = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(pool, { orgId: A, workspaceIds: [workspace] }, fn);
async function conversation(ws = workspace) {
  const id = uuidv7();
  await admin.query(
    `INSERT INTO conversations (id, org_id, workspace_id, state) VALUES ($1, $2, $3, 'BOT_ACTIVE')`,
    [id, A, ws],
  );
  return id;
}
const start = (conversationId: string, versionId = published) =>
  inWs((tx) => startBotSession(tx, { conversationId, versionId, newId: uuidv7 }));
const steps = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ nodeKey: `n${from + i}`, nodeType: 'message' }));

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  await admin.connect();
  pool = createDbPool(url('app'), { max: 2 });
  user = await seedTenant(admin, A);
  workspace = (
    await admin.query<{ id: string }>('SELECT id FROM workspaces WHERE org_id = $1', [A])
  ).rows[0]!.id;
  hidden = uuidv7();
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ws2', 'W2', 'service')`,
    [hidden, A],
  );
  const flow = (
    await admin.query<{ id: string }>('SELECT id FROM bot_flows WHERE org_id = $1', [A])
  ).rows[0]!.id;
  draft = (
    await admin.query<{ id: string }>(
      `SELECT id FROM bot_flow_versions WHERE org_id = $1 AND status = 'draft'`,
      [A],
    )
  ).rows[0]!.id;
  published = uuidv7();
  await admin.query(
    `INSERT INTO bot_flow_versions (id, org_id, flow_id, status, version, published_at) VALUES ($1, $2, $3, 'published', 1, now())`,
    [published, A, flow],
  );
});

afterAll(async () => {
  await pool.end();
  await cleanupTenant(admin, A, user);
  await admin.end();
});

describe('bot-session-store', () => {
  it('starts a session on a published version only, one active per conversation', async () => {
    const conv = await conversation();
    await expect(start(conv, draft)).rejects.toBeInstanceOf(BotVersionNotPublishedError);
    await expect(start(conv, uuidv7())).rejects.toBeInstanceOf(BotVersionNotPublishedError);
    expect(await start(conv)).toMatchObject({
      conversationId: conv,
      versionId: published,
      status: 'active',
      currentNodeKey: null,
      vars: {},
      stepCount: 0,
      version: 0,
    });
    await expect(start(conv)).rejects.toBeInstanceOf(BotSessionActiveError);
  });

  it('writes turns: the state, the steps one index after another, the last 20 on the session, then the end', async () => {
    const conv = await conversation();
    await start(conv);
    const turn = (n: number, from: number, status: BotSessionRow['status'] = 'active') =>
      inWs(async (tx) => {
        const session = (await lockActiveBotSession(tx, conv))!;
        return advanceBotSession(tx, {
          session,
          nodeKey: `n${from + n - 1}`,
          awaiting: status === 'active' ? { kind: 'text' } : null,
          vars: { step: from + n },
          status,
          steps: steps(n, from),
          newId: uuidv7,
        });
      });
    expect(await turn(15, 0)).toMatchObject({ currentNodeKey: 'n14', stepCount: 15, version: 1 });
    const second = await turn(10, 15);
    expect(second).toMatchObject({ stepCount: 25, version: 2, vars: { step: 25 }, endedAt: null });
    expect(second.recentSteps.map((s) => s.nodeKey)).toEqual(steps(20, 5).map((s) => s.nodeKey));
    const last = await turn(1, 25, 'completed');
    expect(last.status).toBe('completed');
    expect(last.endedAt).toBeInstanceOf(Date);
    expect(await inWs((tx) => lockActiveBotSession(tx, conv))).toBeNull();
    const { rows } = await admin.query<{ step_index: number }>(
      `SELECT s.step_index FROM bot_session_steps s JOIN bot_sessions b ON b.id = s.session_id
       WHERE b.conversation_id = $1 ORDER BY s.step_index`,
      [conv],
    );
    expect(rows.map((r) => r.step_index)).toEqual(Array.from({ length: 26 }, (_, i) => i));
  });

  it('keeps the label and the variable of a step, and refuses a turn on a session that moved since it was read', async () => {
    const conv = await conversation();
    const session = await start(conv);
    await inWs((tx) =>
      advanceBotSession(tx, {
        session,
        nodeKey: 'ask',
        awaiting: null,
        vars: {},
        status: 'active',
        steps: [{ nodeKey: 'ask', nodeType: 'question', edgeLabel: 'Có', variable: 'phone' }],
        newId: uuidv7,
      }),
    );
    const { rows } = await admin.query<{ payload: unknown }>(
      'SELECT payload FROM bot_session_steps WHERE session_id = $1',
      [session.id],
    );
    expect(rows).toEqual([{ payload: { edge_label: 'Có', variable: 'phone' } }]);
    await expect(
      inWs((tx) =>
        advanceBotSession(tx, {
          session,
          nodeKey: 'x',
          awaiting: null,
          vars: {},
          status: 'active',
          steps: [],
          newId: uuidv7,
        }),
      ),
    ).rejects.toBeInstanceOf(BotSessionConflictError);
  });

  it('shows the session of a conversation only to who sees it', async () => {
    const conv = await conversation(hidden);
    await admin.query(
      `INSERT INTO bot_sessions (id, org_id, conversation_id, version_id) VALUES ($1, $2, $3, $4)`,
      [uuidv7(), A, conv, published],
    );
    expect(await inWs((tx) => lockActiveBotSession(tx, conv))).toBeNull();
  });
});
