import type { RuntimeGraph } from '@gani/bot-runtime';
import {
  ChannelWindowClosedError,
  type ChannelPolicyService,
  type ConversationStateMachine,
  type MessageService,
} from '@gani/conversations';
import type { BotSessionRow, TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { createBotTurn, runBotTurn, type BotTurnInput, type BotTurnStore } from './bot-turn.js';

// The bot's turn in the transaction of an inbound event (D1b3a), over fakes of the store and the services; the SQL itself is tested on
// PostgreSQL in test/bot-turn.spec.ts.
const tx = {} as TenantTx;
const resolves = <T>(value: T) => vi.fn(() => Promise.resolve(value));
const n = (key: string, type: string, config: Record<string, unknown> = {}) => ({
  key,
  type,
  config,
});
const GRAPH: RuntimeGraph = {
  nodes: [
    n('start', 'trigger', { on: 'first_message' }),
    n('hi', 'message', { text: 'Chào {{customer.name}}' }),
    n('pack', 'question', {
      text: 'Loại?',
      kind: 'choice',
      choices: ['Hộp', 'Thùng'],
      variable: 'pack',
    }),
    n('done', 'end'),
  ],
  edges: [
    { from: 'start', to: 'hi', label: null },
    { from: 'hi', to: 'pack', label: null },
    { from: 'pack', to: 'done', label: null },
  ],
};
const session = (over: Partial<BotSessionRow> = {}): BotSessionRow => ({
  id: 's1',
  conversationId: 'c1',
  versionId: 'v1',
  status: 'active',
  currentNodeKey: null,
  awaiting: null,
  vars: {},
  recentSteps: [],
  stepCount: 0,
  version: 0,
  startedAt: new Date(0),
  endedAt: null,
  ...over,
});
const INPUT: BotTurnInput = {
  conversationId: 'c1',
  workspaceId: 'w1',
  channelAccountId: 'a1',
  customerId: 'k1',
  text: 'xin chào',
  firstOfConversation: true,
  traceId: 't1',
  now: new Date(0),
};

function setup(over: Partial<{ [K in keyof BotTurnStore]: unknown }> = {}, graph = GRAPH) {
  const store = {
    loadConversation: resolves({ state: 'BOT_ACTIVE', afterHoursHold: false }),
    lockActiveBotSession: resolves(null),
    listBotTriggers: resolves([
      { flowId: 'f1', versionId: 'v1', trigger: { on: 'first_message' } },
    ]),
    startBotSession: resolves(session()),
    loadBotFlowVersion: resolves({ graph }),
    loadCustomer: resolves({ displayName: 'Lan' }),
    insertPendingDelivery: resolves(undefined),
    advanceBotSession: resolves(session()),
    setConversationPriority: resolves(true),
    ...over,
  };
  let sent = 0;
  const messages = { append: vi.fn(() => Promise.resolve({ id: `m${++sent}` })) };
  const fsm = { transition: resolves({ kind: 'changed' }) };
  const policy = { check: resolves({ state: 'open' }) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const services = {
    fsm: fsm as unknown as ConversationStateMachine,
    messages: messages as unknown as MessageService,
    policy: policy as unknown as ChannelPolicyService,
    log,
    store: store as unknown as BotTurnStore,
  };
  const run = (input: Partial<BotTurnInput> = {}) =>
    runBotTurn(tx, services, { ...INPUT, ...input });
  return { store, messages, fsm, policy, log, services, run };
}
/** What the turn wrote to the session (the first advance). */
const advanced = (t: ReturnType<typeof setup>): unknown =>
  ((t.store.advanceBotSession as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[1];
/** T02 asked by the bot, with the reason kept in the history (U78). */
const needsHuman = (reason: string) => [
  tx,
  'c1',
  { type: 'needs_human', inHours: true },
  { actor: { kind: 'bot' }, traceId: 't1', detail: { reason } },
];

describe('runBotTurn', () => {
  it('leaves alone a conversation the bot does not hold', async () => {
    for (const conversation of [
      null,
      { state: 'HUMAN_ACTIVE', afterHoursHold: false },
      { state: 'BOT_ACTIVE', afterHoursHold: true },
    ]) {
      const t = setup({ loadConversation: resolves(conversation) });
      expect(await t.run()).toBe('skipped');
      expect(t.store.lockActiveBotSession).not.toHaveBeenCalled();
    }
  });

  it('hands over when no session runs and no flow fits', async () => {
    const t = setup({ listBotTriggers: resolves([]) });
    expect(await t.run()).toBe('no_flow');
    expect(t.fsm.transition).toHaveBeenCalledWith(...needsHuman('no_flow'));
    expect(t.store.setConversationPriority).toHaveBeenCalledWith(tx, 'c1', 'normal');
    expect(t.store.startBotSession).not.toHaveBeenCalled();
    // A conversation the state machine does not move keeps its priority.
    const waiting = setup({ listBotTriggers: resolves([]) });
    waiting.fsm.transition.mockResolvedValueOnce({ kind: 'unchanged' });
    await waiting.run();
    expect(waiting.store.setConversationPriority).not.toHaveBeenCalled();
  });

  it('starts the flow, sends each message as a pending delivery, and waits for the answer', async () => {
    const t = setup();
    expect(await t.run()).toBe('active');
    expect(t.store.startBotSession).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ conversationId: 'c1', versionId: 'v1' }),
    );
    expect(t.messages.append.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { conversationId: 'c1', senderKind: 'bot', kind: 'text', body: 'Chào Lan', traceId: 't1' },
      {
        conversationId: 'c1',
        senderKind: 'bot',
        kind: 'text',
        body: 'Loại?\n1. Hộp\n2. Thùng',
        traceId: 't1',
      },
    ]);
    expect(t.policy.check).toHaveBeenCalledTimes(2);
    expect(t.store.insertPendingDelivery).toHaveBeenLastCalledWith(
      tx,
      expect.objectContaining({
        workspaceId: 'w1',
        conversationId: 'c1',
        messageId: 'm2',
        channelAccountId: 'a1',
      }),
    );
    expect(t.store.advanceBotSession).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ nodeKey: 'pack', awaiting: { attempts: 0 }, status: 'active' }),
    );
    expect(t.fsm.transition).not.toHaveBeenCalled();
  });

  it('goes on with the active session, the answer taken from the message', async () => {
    const waiting = session({ currentNodeKey: 'pack', awaiting: { attempts: 0 } });
    const t = setup({
      lockActiveBotSession: resolves(waiting),
      loadCustomer: resolves(null),
    });
    expect(await t.run({ text: '2', firstOfConversation: false })).toBe('completed');
    expect(t.store.listBotTriggers).not.toHaveBeenCalled();
    expect(t.store.advanceBotSession).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        session: waiting,
        nodeKey: 'done',
        awaiting: null,
        vars: { pack: 'Thùng' },
        status: 'completed',
      }),
    );
    // A sticker answers nothing: the question is asked again.
    const t2 = setup({ lockActiveBotSession: resolves(waiting) });
    expect(await t2.run({ text: null })).toBe('active');
    expect(t2.store.advanceBotSession).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ awaiting: { attempts: 1 } }),
    );
  });

  it('stops at a closed window and abandons the session without handing over', async () => {
    const t = setup();
    t.policy.check
      .mockResolvedValueOnce({ state: 'open' })
      .mockRejectedValueOnce(new ChannelWindowClosedError('api_closed', 'no_policy'));
    expect(await t.run()).toBe('abandoned');
    expect(t.messages.append).toHaveBeenCalledTimes(1);
    expect(t.log.warn).toHaveBeenCalledWith('bot_window_closed', {
      conversationId: 'c1',
      workspaceId: 'w1',
      traceId: 't1',
      code: 'api_closed',
    });
    expect(t.store.advanceBotSession).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ status: 'abandoned', awaiting: null }),
    );
    expect(t.fsm.transition).not.toHaveBeenCalled();
    const boom = setup();
    boom.policy.check.mockRejectedValueOnce(new Error('db down'));
    await expect(boom.run()).rejects.toThrow('db down');
  });

  it('hands over a broken flow and a flow that hands over', async () => {
    const broken = setup(
      {},
      {
        nodes: [n('start', 'trigger'), n('m', 'message')],
        edges: [{ from: 'start', to: 'm', label: null }],
      },
    );
    expect(await broken.run()).toBe('abandoned');
    expect(broken.log.warn).toHaveBeenCalledWith(
      'bot_flow_broken',
      expect.objectContaining({ code: 'bad_config' }),
    );
    expect(broken.fsm.transition).toHaveBeenCalledWith(...needsHuman('bad_config'));
    const tired = session({ currentNodeKey: 'pack', awaiting: { attempts: 2 } });
    const t = setup({ lockActiveBotSession: resolves(tired) });
    expect(await t.run({ text: 'gì cũng được' })).toBe('handed_off');
    expect(t.fsm.transition).toHaveBeenCalledWith(...needsHuman('question_unanswered'));
    expect(t.log.warn).not.toHaveBeenCalled();
    // A handoff node: its reason in the history, its priority on the conversation.
    const node = setup(
      {},
      {
        nodes: [
          n('start', 'trigger'),
          n('h', 'handoff', { reason: 'Khiếu nại', priority: 'urgent' }),
        ],
        edges: [{ from: 'start', to: 'h', label: null }],
      },
    );
    expect(await node.run()).toBe('handed_off');
    expect(node.fsm.transition).toHaveBeenCalledWith(...needsHuman('Khiếu nại'));
    expect(node.store.setConversationPriority).toHaveBeenCalledWith(tx, 'c1', 'urgent');
  });

  it('jumps to the published version of another flow with the variables, at most MAX_JUMPS a turn', async () => {
    const other = '0190a000-0000-7000-8000-000000000002';
    const JUMPER: RuntimeGraph = {
      nodes: [
        n('start', 'trigger', { on: 'first_message' }),
        n('mark', 'set_variable', { variable: 'from', value: 'jumper' }),
        n('go', 'jump_to_flow', { flowId: other }),
      ],
      edges: [
        { from: 'start', to: 'mark', label: null },
        { from: 'mark', to: 'go', label: null },
      ],
    };
    const triggers = [
      { flowId: 'f1', versionId: 'v1', trigger: { on: 'first_message' } },
      { flowId: other, versionId: 'v2', trigger: { on: 'keyword', keywords: ['x'] } },
    ];
    const versions = (second: RuntimeGraph) =>
      vi.fn((_tx: unknown, id: string) =>
        Promise.resolve({ graph: id === 'v1' ? JUMPER : second }),
      );
    const t = setup({ listBotTriggers: resolves(triggers), loadBotFlowVersion: versions(GRAPH) });
    expect(await t.run()).toBe('active');
    expect(t.messages.append).toHaveBeenCalledTimes(2);
    expect(t.store.advanceBotSession).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ versionId: 'v2', nodeKey: 'pack', vars: { from: 'jumper' } }),
    );
    const steps = advanced(t) as {
      steps: { nodeKey: string }[];
    };
    expect(steps.steps.map((x) => x.nodeKey)).toEqual([
      'start',
      'mark',
      'go',
      'start',
      'hi',
      'pack',
    ]);
    // Two flows that jump to each other: stopped after MAX_JUMPS, abandoned and handed over.
    const loop = setup({
      listBotTriggers: resolves(triggers),
      loadBotFlowVersion: resolves({ graph: { ...JUMPER } }),
    });
    expect(await loop.run()).toBe('abandoned');
    expect(loop.log.warn).toHaveBeenCalledWith(
      'bot_flow_broken',
      expect.objectContaining({ code: 'jump_limit' }),
    );
    expect(loop.fsm.transition).toHaveBeenCalledWith(...needsHuman('jump_limit'));
    // A flow that is not there: abandoned and handed over.
    const lost = setup({
      listBotTriggers: resolves([triggers[0]]),
      loadBotFlowVersion: versions(GRAPH),
    });
    expect(await lost.run()).toBe('abandoned');
    expect(lost.log.warn).toHaveBeenCalledWith(
      'bot_flow_broken',
      expect.objectContaining({ code: 'jump_target' }),
    );
    expect(lost.fsm.transition).toHaveBeenCalledWith(...needsHuman('jump_target'));
    // Without a jump the session keeps its version.
    const plain = setup();
    await plain.run();
    expect(advanced(plain)).not.toHaveProperty('versionId');
  });

  it('fails loud when the version of the session is missing', async () => {
    const t = setup({ loadBotFlowVersion: resolves(null) });
    await expect(t.run()).rejects.toThrow('missing');
  });

  it('is the bot of the inbound services through createBotTurn', async () => {
    const t = setup({ listBotTriggers: resolves([]) });
    expect(await createBotTurn(t.services)(tx, INPUT)).toBe('no_flow');
  });
});
