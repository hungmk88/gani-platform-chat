import type {
  ConversationRow,
  NewConversationEvent,
  NewMessage,
  NewOutboxEvent,
  TenantTx,
} from '@gani/db';
import { describe, expect, it } from 'vitest';

import { ConversationStateMachine, type ConversationStore } from './conversation-state-machine.js';
import {
  ConversationNotFoundError,
  InvalidMessageError,
  type InvalidMessageReason,
} from './errors.js';
import { MessageService, type AppendMessageInput, type MessageStore } from './message-service.js';

// The message service and `onCustomerMessage` against fakes that behave like the real stores (the same conditional UPDATE, version + 1).
// `decide` is the real one from the domain package, so the table of FSM spec §2 is what is tested.
const TX = {} as TenantTx;
const [ID, U1, U2] = ['c-1', 'user-1', 'user-2'];
const NOW = new Date('2026-10-06T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PII = 'Nguyen Van A 0901234567';

// prettier-ignore
const row = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: ID, orgId: 'org', workspaceId: 'w-1', state: 'BOT_ACTIVE', version: 3, assignedUserId: null, afterHoursHold: false, closedAt: null, outcome: null, ...over,
});
const pending = () => row({ state: 'PENDING_CUSTOMER', assignedUserId: U1 });
const closedAgo = (ms: number) =>
  row({ state: 'CLOSED', closedAt: new Date(NOW.getTime() - ms), outcome: 'won' });

// prettier-ignore
function fake(initial: ConversationRow | null) {
  const rows = new Map(initial ? [[ID, initial]] : []);
  const calls: string[] = [];
  const events: NewConversationEvent[] = [];
  const outbox: NewOutboxEvent[] = [];
  const messages: NewMessage[] = [];
  const conversations: ConversationStore = {
    loadConversation: (_tx, id) => (calls.push('load'), Promise.resolve(rows.get(id) ?? null)),
    insertConversation: () => Promise.reject(new Error('not used')),
    insertConversationEvent: (_tx, e) => (events.push(e), Promise.resolve()),
    insertOutboxEvent: (_tx, e) => (outbox.push(e), Promise.resolve()),
    applyTransition: (_tx, w) => {
      calls.push('apply');
      const r = rows.get(w.id);
      if (!r || r.state !== w.from.state || r.afterHoursHold !== w.from.afterHoursHold) return Promise.resolve(null);
      const next = { ...r, ...w.next, version: r.version + 1 };
      return (rows.set(w.id, next), Promise.resolve(next));
    },
  };
  const store: MessageStore = {
    loadConversation: conversations.loadConversation,
    insertMessage: (_tx, m) => (calls.push('insertMessage'), messages.push(m), Promise.resolve({ id: m.id, sequenceNumber: messages.length })),
  };
  const fsm = new ConversationStateMachine(conversations);
  return { fsm, service: new MessageService(fsm, store), rows, calls, events, outbox, messages };
}
const append = (over: Partial<AppendMessageInput> = {}): AppendMessageInput => ({
  conversationId: ID,
  senderKind: 'customer',
  kind: 'text',
  body: 'hello',
  traceId: 'trace-1',
  ...over,
});
const received = (over: { body?: string | null } = {}) => ({
  conversationId: ID,
  kind: 'text' as const,
  body: 'hello',
  traceId: 'trace-1',
  ...over,
});
const customerMessage = (agentOnline: boolean, now = NOW) => ({
  now,
  agentOnline,
  traceId: 'trace-1',
});

describe('onCustomerMessage', () => {
  it('T10: a customer who answers while the agent is online goes back to HUMAN_ACTIVE, with the same agent', async () => {
    const { fsm, rows, events } = fake(pending());
    const out = await fsm.onCustomerMessage(TX, ID, customerMessage(true));
    expect(out).toMatchObject({ kind: 'changed', transition: 'T10' });
    expect(rows.get(ID)).toMatchObject({ state: 'HUMAN_ACTIVE', assignedUserId: U1, version: 4 });
    expect(events).toMatchObject([
      {
        eventType: 'state_changed',
        fromState: 'PENDING_CUSTOMER',
        toState: 'HUMAN_ACTIVE',
        actorKind: 'customer',
        actorId: null,
        traceId: 'trace-1',
      },
    ]);
  });

  it('T11: with no agent online the conversation goes to the queue and loses its person', async () => {
    const { fsm, rows } = fake(pending());
    expect(await fsm.onCustomerMessage(TX, ID, customerMessage(false))).toMatchObject({
      kind: 'changed',
      transition: 'T11',
    });
    expect(rows.get(ID)).toMatchObject({
      state: 'HUMAN_WAITING_Q',
      assignedUserId: null,
      version: 4,
    });
  });

  it.each([['BOT_ACTIVE'], ['HUMAN_WAITING_Q'], ['HUMAN_ACTIVE']] as const)(
    'N1: %s does not change, online or not, and nothing is written',
    async (state) => {
      for (const online of [true, false]) {
        const { fsm, calls, events, outbox } = fake(
          row({ state, assignedUserId: state === 'HUMAN_ACTIVE' ? U1 : null }),
        );
        expect(await fsm.onCustomerMessage(TX, ID, customerMessage(online))).toEqual({
          kind: 'unchanged',
          reason: 'customer_message_keeps_state',
        });
        expect([calls.includes('apply'), events.length, outbox.length]).toEqual([false, 0, 0]);
      }
    },
  );

  it.each([
    ['71h59m', 72 * HOUR - MINUTE, 'T14'],
    ['72h00m00s (the limit counts)', 72 * HOUR, 'T14'],
  ])(
    'T14: closed %s ago, the conversation reopens as BOT_ACTIVE with no close',
    async (_label, ago) => {
      const { fsm, rows, events } = fake(closedAgo(ago));
      expect(await fsm.onCustomerMessage(TX, ID, customerMessage(false))).toMatchObject({
        kind: 'changed',
        transition: 'T14',
      });
      expect(rows.get(ID)).toMatchObject({
        state: 'BOT_ACTIVE',
        closedAt: null,
        outcome: null,
        version: 4,
      });
      expect(events).toMatchObject([
        { eventType: 'reopened', fromState: 'CLOSED', toState: 'BOT_ACTIVE' },
      ]);
    },
  );

  it('N2: closed 72h01m ago, the window has passed and nothing changes', async () => {
    const { fsm, rows, events } = fake(closedAgo(72 * HOUR + MINUTE));
    expect(await fsm.onCustomerMessage(TX, ID, customerMessage(true))).toEqual({
      kind: 'unchanged',
      reason: 'reopen_window_passed',
    });
    expect(rows.get(ID)).toMatchObject({ state: 'CLOSED', version: 3 });
    expect(events).toEqual([]);
  });

  it('is not found for a conversation nobody can see', async () => {
    await expect(fake(null).fsm.onCustomerMessage(TX, ID, customerMessage(true))).rejects.toThrow(
      ConversationNotFoundError,
    );
  });
});

describe('MessageService.append', () => {
  it('stores a message in the workspace of the conversation it read, with what it was given', async () => {
    const { service, messages } = fake(row({ workspaceId: 'w-9' }));
    const sentAt = new Date('2026-10-06T11:00:00Z');
    const stored = await service.append(
      TX,
      append({ platformMessageId: 'p-1', platformSentAt: sentAt }),
    );
    expect(stored).toEqual({ id: messages[0]?.id, sequenceNumber: 1 });
    expect(messages).toMatchObject([
      {
        conversationId: ID,
        workspaceId: 'w-9',
        senderKind: 'customer',
        senderUserId: null,
        kind: 'text',
        body: 'hello',
        platformMessageId: 'p-1',
        platformSentAt: sentAt,
      },
    ]);
  });

  it('lets an agent have a user, and an image or a sticker have no body', async () => {
    const { service, messages } = fake(row());
    await service.append(TX, append({ senderKind: 'agent', senderUserId: U2 }));
    await service.append(TX, append({ kind: 'image', body: null }));
    await service.append(TX, {
      conversationId: ID,
      senderKind: 'customer',
      kind: 'sticker',
      traceId: 't',
    });
    expect(messages.map((m) => [m.senderKind, m.senderUserId, m.kind, m.body])).toEqual([
      ['agent', U2, 'text', 'hello'],
      ['customer', null, 'image', null],
      ['customer', null, 'sticker', null],
    ]);
  });

  it.each<[string, Partial<AppendMessageInput>, InvalidMessageReason]>([
    ['an agent with no user', { senderKind: 'agent' }, 'agent_needs_user'],
    ['an agent with an empty user', { senderKind: 'agent', senderUserId: '' }, 'agent_needs_user'],
    ['a customer with a user', { senderKind: 'customer', senderUserId: U1 }, 'only_agent_has_user'],
    ['the bot with a user', { senderKind: 'bot', senderUserId: U1 }, 'only_agent_has_user'],
    ['a text with no body', { senderKind: 'customer', body: null }, 'text_needs_body'],
    ['a text with a blank body', { senderKind: 'customer', body: '   ' }, 'text_needs_body'],
  ])(
    'refuses %s (%s), stores nothing, and the error does not carry the message',
    async (_name, over, reason) => {
      const { service, calls } = fake(row());
      const error = await service
        .append(TX, append({ body: PII, ...over }))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidMessageError);
      expect(error).toMatchObject({ reason });
      expect((error as Error).message).not.toContain('Nguyen');
      expect(calls).toEqual([]);
    },
  );

  it('is not found for a conversation nobody can see, and stores nothing', async () => {
    const { service, calls } = fake(null);
    await expect(service.append(TX, append())).rejects.toThrow(ConversationNotFoundError);
    expect(calls).toEqual(['load']);
  });
});

describe('MessageService.receiveCustomerMessage', () => {
  it('stores the message and then lets the state machine decide, in that order, and returns both', async () => {
    const { service, calls, rows, messages } = fake(pending());
    const result = await service.receiveCustomerMessage(TX, {
      ...received(),
      agentOnline: false,
      now: NOW,
    });
    expect(calls).toEqual(['load', 'insertMessage', 'load', 'apply']);
    expect(messages).toMatchObject([{ senderKind: 'customer', senderUserId: null }]);
    expect(result.message.sequenceNumber).toBe(1);
    expect(result.outcome).toMatchObject({ kind: 'changed', transition: 'T11' });
    expect(rows.get(ID)?.state).toBe('HUMAN_WAITING_Q');
  });

  it('passes agentOnline on: the same message goes to HUMAN_ACTIVE when an agent is online', async () => {
    const { service } = fake(pending());
    const result = await service.receiveCustomerMessage(TX, {
      ...received(),
      agentOnline: true,
      now: NOW,
    });
    expect(result.outcome).toMatchObject({ kind: 'changed', transition: 'T10' });
  });

  it('uses the clock of the moment when no time is given: a conversation closed an hour ago reopens', async () => {
    const closed = row({ state: 'CLOSED', closedAt: new Date(Date.now() - HOUR), outcome: 'won' });
    const { service } = fake(closed);
    const result = await service.receiveCustomerMessage(TX, { ...received(), agentOnline: false });
    expect(result.outcome).toMatchObject({ kind: 'changed', transition: 'T14' });
  });

  it('stores the message and says unchanged for a conversation closed longer than the window (the caller must have checked)', async () => {
    const { service, messages } = fake(closedAgo(80 * HOUR));
    const result = await service.receiveCustomerMessage(TX, {
      ...received(),
      agentOnline: false,
      now: NOW,
    });
    expect(result.outcome).toEqual({ kind: 'unchanged', reason: 'reopen_window_passed' });
    expect(messages).toHaveLength(1);
  });

  it('does not call the state machine when the message is refused', async () => {
    const { service, calls } = fake(pending());
    await expect(
      service.receiveCustomerMessage(TX, { ...received({ body: ' ' }), agentOnline: true }),
    ).rejects.toThrow(InvalidMessageError);
    expect(calls).toEqual([]);
  });
});
