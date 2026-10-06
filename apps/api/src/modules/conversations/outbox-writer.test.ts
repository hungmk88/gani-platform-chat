import type { NewOutboxEvent, TenantTx } from '@gani/db';
import type { ConversationEffect } from '@gani/domain';
import { describe, expect, it, vi } from 'vitest';

import { OutboxWriter, conversationOutboxEvent, type ConversationFact } from './outbox-writer.js';

const TX = {} as TenantTx;
// prettier-ignore
const fact = (over: Partial<ConversationFact> = {}): ConversationFact => ({
  conversationId: 'c-1', workspaceId: 'w-1', version: 2, transition: 'T05', from: { state: 'HUMAN_WAITING_Q', afterHoursHold: false, assignedUserId: null },
  to: { state: 'HUMAN_ACTIVE', afterHoursHold: false, assignedUserId: 'u-2' }, actor: { kind: 'agent', id: 'u-2' }, traceId: 'trace', ...over,
});

describe('conversationOutboxEvent: one row per effect, references only', () => {
  // prettier-ignore
  it.each<[ConversationEffect, Record<string, unknown>]>([
    ['conversation.created', { conversationId: 'c-1' }],
    ['conversation.state_changed', { conversationId: 'c-1', from: 'HUMAN_WAITING_Q', to: 'HUMAN_ACTIVE', hold: false }],
    ['conversation.assigned', { conversationId: 'c-1', assignedUserId: 'u-2' }],
    ['agent.transferred', { conversationId: 'c-1', fromUserId: null, toUserId: 'u-2' }],
    ['agent.reassigned', { conversationId: 'c-1', fromUserId: null, toUserId: 'u-2' }],
    ['conversation.handoff_requested', { conversationId: 'c-1' }],
  ])('%s', (effect, payload) => {
    expect(conversationOutboxEvent(effect, fact())).toMatchObject({
      eventType: effect, workspaceId: 'w-1', aggregateType: 'conversation', aggregateId: 'c-1', aggregateVersion: 2,
      actorKind: 'agent', actorId: 'u-2', traceId: 'trace', payload,
    });
  });

  it('gives each row its own id, and no actor id when the actor has none', () => {
    const a = conversationOutboxEvent('conversation.created', fact({ actor: { kind: 'bot' } }));
    const b = conversationOutboxEvent('conversation.created', fact());
    expect(a.id).not.toBe(b.id);
    expect(a.actorId).toBeNull();
  });

  it('names the reason of a manager alert, and refuses an alert no transition asks for', () => {
    expect(
      conversationOutboxEvent('conversation.manager_alert', fact({ transition: 'T17' })).payload,
    ).toEqual({ conversationId: 'c-1', reason: 'agent_offline' });
    expect(() =>
      conversationOutboxEvent('conversation.manager_alert', fact({ transition: 'T05' })),
    ).toThrow(/no reason/);
  });
});

describe('OutboxWriter', () => {
  const event = (payload: Record<string, unknown>): NewOutboxEvent => ({
    ...conversationOutboxEvent('conversation.created', fact()),
    payload,
  });

  it('hands a clean event to the store on the same transaction', async () => {
    const insertOutboxEvent = vi.fn(() => Promise.resolve());
    const e = event({
      conversationId: 'c-1',
      messageId: 'm-1',
      sequenceNumber: 4,
      hold: false,
      from: null,
    });
    await new OutboxWriter({ insertOutboxEvent }).add(TX, e);
    expect(insertOutboxEvent).toHaveBeenCalledWith(TX, e);
  });

  it.each(['messageText', 'body', 'content', 'displayName', 'email', 'phone', 'address'])(
    'refuses the payload key %s: it holds content or a person, not a reference',
    async (key) => {
      const insertOutboxEvent = vi.fn(() => Promise.resolve());
      await expect(
        new OutboxWriter({ insertOutboxEvent }).add(TX, event({ [key]: 'x' })),
      ).rejects.toThrow(/looks like content/);
      expect(insertOutboxEvent).not.toHaveBeenCalled();
    },
  );

  it('refuses a value that is not a plain one (a nested object or a list)', async () => {
    const writer = new OutboxWriter({ insertOutboxEvent: () => Promise.resolve() });
    await expect(writer.add(TX, event({ ids: ['a'] }))).rejects.toThrow(/not a plain value/);
    await expect(writer.add(TX, event({ ref: { id: 'a' } }))).rejects.toThrow(/not a plain value/);
  });
});
