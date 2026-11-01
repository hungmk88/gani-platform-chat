import {
  ChannelPolicyService,
  ConversationStateMachine,
  MessageService,
} from '@gani/conversations';
import {
  claimInboundBatch,
  createBotFlow,
  insertIfAbsent,
  publishBotFlow,
  saveBotFlowDraft,
  withTenant,
  type BotGraph,
  type ClaimedInboundEvent,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBotTurn } from '../src/inbound/bot-turn.js';
import { processInboundEvent } from '../src/inbound/process-event.js';
import { adminPool, appPool, seedOrg, type Pool } from './db.js';

// The scripted bot in the inbound transaction on PostgreSQL as app_role (D1b3a): a published flow greets the first message of a
// conversation and asks, the answer completes it; the bot's messages are stored with a pending delivery; a workspace without a flow
// hands the conversation to a person (T02). The SQL that lists the flows is tested in packages/db (bot-trigger-read.spec.ts).
let admin: Pool;
let app: Pool;
let org = '';
const [user, withFlow, noFlow, jumpWs] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const accounts = new Map<string, string>([
  [withFlow, uuidv7()],
  [noFlow, uuidv7()],
  [jumpWs, uuidv7()],
]);
const fsm = new ConversationStateMachine();
const messages = new MessageService(fsm, undefined, undefined, { warn: () => undefined });
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };
const services = {
  fsm,
  messages,
  bot: createBotTurn({ fsm, messages, policy: new ChannelPolicyService(), log }),
};
const tenant = (ws: string) => ({ orgId: org, workspaceIds: [ws] });
const GRAPH: BotGraph = {
  nodes: [
    { key: 'start', type: 'trigger', config: { on: 'first_message' } },
    { key: 'hi', type: 'message', config: { text: 'Chào bạn' } },
    {
      key: 'pack',
      type: 'question',
      config: { text: 'Loại?', kind: 'choice', choices: ['Hộp', 'Thùng'], variable: 'pack' },
    },
    { key: 'done', type: 'end', config: {} },
  ],
  edges: [
    { from: 'start', to: 'hi', label: null },
    { from: 'hi', to: 'pack', label: null },
    { from: 'pack', to: 'done', label: null },
  ],
};

async function makeFlow(ws: string, publishTimes: number, graph: BotGraph = GRAPH) {
  return withTenant(app, tenant(ws), async (tx) => {
    const { flow } = await createBotFlow(tx, {
      workspaceId: ws,
      name: 'F',
      createdBy: user,
      newId: uuidv7,
    });
    await saveBotFlowDraft(tx, { flowId: flow.id, graph, savedBy: user, newId: uuidv7 });
    let versionId = '';
    for (let i = 0; i < publishTimes; i++)
      ({ versionId } = await publishBotFlow(tx, {
        flowId: flow.id,
        publishedBy: user,
        newId: uuidv7,
      }));
    return { flowId: flow.id, versionId };
  });
}

async function say(ws: string, person: string, text: string): Promise<void> {
  const id = uuidv7();
  const msgId = `m-${uuidv7()}`;
  await withTenant(app, tenant(ws), (tx) =>
    insertIfAbsent(tx, {
      id,
      workspaceId: ws,
      channelAccountId: accounts.get(ws)!,
      platformMessageId: msgId,
      eventType: 'user_send_text',
      payload: {
        event_name: 'user_send_text',
        timestamp: String(Date.now()),
        sender: { id: person },
        message: { msg_id: msgId, text },
      },
    }),
  );
  const claimed = await withTenant(app, tenant(ws), (tx) =>
    claimInboundBatch(tx, { limit: 100, workspaceId: ws }),
  );
  const event = claimed.find((e) => e.id === id) as ClaimedInboundEvent;
  await withTenant(app, tenant(ws), (tx) => processInboundEvent(tx, event, services));
}
const rows = async <T>(sql: string, params: unknown[]) =>
  (await admin.query(sql, params)).rows as T[];
const conversationOf = async (person: string) =>
  (
    await rows<{ id: string; state: string }>(
      'SELECT id, state FROM conversations WHERE external_user_id = $1',
      [person],
    )
  )[0]!;

beforeAll(async () => {
  [admin, app] = [adminPool(), appPool()];
  org = await seedOrg(admin);
  await admin.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [
    user,
    `${user}@example.test`,
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'owner', 'active')`,
    [uuidv7(), org, user],
  );
  for (const [ws, account] of accounts) {
    await admin.query(
      `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
      [ws, org, `w-${ws}`],
    );
    await admin.query(
      `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, status)
       VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', 'connected')`,
      [account, org, ws, `oa-${account}`],
    );
  }
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('the bot in the inbound transaction', () => {
  it('greets and asks on the first message, then completes on the answer', async () => {
    await makeFlow(withFlow, 1);
    const person = `zu-${uuidv7()}`;
    await say(withFlow, person, 'xin chào');
    const conversation = await conversationOf(person);
    expect(conversation.state).toBe('BOT_ACTIVE');
    const sent = () =>
      rows<{ sender_kind: string; body: string; delivery: string | null }>(
        `SELECT m.sender_kind, m.body, d.status AS delivery FROM messages m
         LEFT JOIN message_deliveries d ON d.org_id = m.org_id AND d.message_id = m.id
         WHERE m.conversation_id = $1 ORDER BY m.sequence_number`,
        [conversation.id],
      );
    expect(await sent()).toEqual([
      { sender_kind: 'customer', body: 'xin chào', delivery: null },
      { sender_kind: 'bot', body: 'Chào bạn', delivery: 'pending' },
      { sender_kind: 'bot', body: 'Loại?\n1. Hộp\n2. Thùng', delivery: 'pending' },
    ]);
    const session = () =>
      rows<{ status: string; current_node_key: string; vars: unknown; step_count: number }>(
        'SELECT status, current_node_key, vars, step_count FROM bot_sessions WHERE conversation_id = $1',
        [conversation.id],
      );
    expect(await session()).toEqual([
      { status: 'active', current_node_key: 'pack', vars: {}, step_count: 3 },
    ]);
    await say(withFlow, person, '2');
    expect(await session()).toEqual([
      { status: 'completed', current_node_key: 'done', vars: { pack: 'Thùng' }, step_count: 5 },
    ]);
    expect(
      await rows(
        "SELECT node_key, payload->>'edge_label' AS edge_label, payload->>'variable' AS variable FROM bot_session_steps WHERE conversation_id = $1 ORDER BY step_index",
        [conversation.id],
      ),
    ).toEqual([
      { node_key: 'start', edge_label: null, variable: null },
      { node_key: 'hi', edge_label: null, variable: null },
      { node_key: 'pack', edge_label: null, variable: null },
      { node_key: 'pack', edge_label: null, variable: 'pack' },
      { node_key: 'done', edge_label: null, variable: null },
    ]);
  });

  it('jumps to the published version of another flow of the workspace, the session moved to it (D1b3b)', async () => {
    const target = await makeFlow(jumpWs, 1, {
      ...GRAPH,
      nodes: GRAPH.nodes.map((node) =>
        node.type === 'trigger' ? { ...node, config: { on: 'keyword', keywords: ['zzz'] } } : node,
      ),
    });
    await makeFlow(jumpWs, 1, {
      nodes: [
        { key: 'start', type: 'trigger', config: { on: 'first_message' } },
        { key: 'go', type: 'jump_to_flow', config: { flowId: target.flowId } },
      ],
      edges: [{ from: 'start', to: 'go', label: null }],
    });
    const person = `zu-${uuidv7()}`;
    await say(jumpWs, person, 'xin chào');
    const conversation = await conversationOf(person);
    expect(
      await rows(
        'SELECT version_id, status, current_node_key FROM bot_sessions WHERE conversation_id = $1',
        [conversation.id],
      ),
    ).toEqual([{ version_id: target.versionId, status: 'active', current_node_key: 'pack' }]);
    expect(
      (
        await rows<{ node_key: string }>(
          'SELECT node_key FROM bot_session_steps WHERE conversation_id = $1 ORDER BY step_index',
          [conversation.id],
        )
      ).map((r) => r.node_key),
    ).toEqual(['start', 'go', 'start', 'hi', 'pack']);
  });

  it('hands a conversation to a person when no flow fits (T02)', async () => {
    const person = `zu-${uuidv7()}`;
    await say(noFlow, person, 'xin chào');
    const conversation = await conversationOf(person);
    expect(conversation.state).toBe('HUMAN_WAITING_Q');
    expect(
      await rows('SELECT 1 FROM bot_sessions WHERE conversation_id = $1', [conversation.id]),
    ).toEqual([]);
    // A person's conversation never hears the bot: the next message stores, nothing more.
    await say(noFlow, person, 'alo');
    expect(
      await rows("SELECT 1 FROM messages WHERE conversation_id = $1 AND sender_kind = 'bot'", [
        conversation.id,
      ]),
    ).toEqual([]);
  });
});
