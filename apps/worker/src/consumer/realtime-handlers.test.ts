import type { TenantContext, TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../logger.js';
import type { EventJobData } from '../relay/job.js';
import { PermanentEventError } from './event-consumer.js';
import { realtimeHandlers } from './realtime-handlers.js';

const [ORG, WS, C, M, U1, U2] = ['org', 'ws', 'conv-1', 'msg-1', 'user-1', 'user-2'];
const tenant: TenantContext = { orgId: ORG, workspaceIds: [WS] };
const event = (
  type: string,
  payload: Record<string, unknown>,
  version: number | null = 4,
): EventJobData => ({
  id: 'ev-1',
  type,
  version: 1,
  orgId: ORG,
  workspaceId: WS,
  occurredAt: '2026-10-21T10:00:00.000Z',
  traceId: 'trace-1',
  actor: { kind: 'customer', id: null },
  aggregate: { type: 'conversation', id: C, version },
  payload,
});

const db = vi.hoisted(() => {
  const state: { message: unknown; view: unknown; reads: string[] } = {
    message: null,
    view: null,
    reads: [],
  };
  return state;
});
vi.mock('@gani/db', () => ({
  loadMessageView: vi.fn(
    (_tx: unknown, id: string) => (db.reads.push(`message ${id}`), Promise.resolve(db.message)),
  ),
  loadConversationView: vi.fn(
    (_tx: unknown, id: string) => (db.reads.push(`conversation ${id}`), Promise.resolve(db.view)),
  ),
}));

// The emitter is a fake that records each packet with its rooms; `read` records the tenant it was given.
function setup() {
  const sent: { rooms: readonly string[]; event: string; packet: Record<string, unknown> }[] = [];
  const tenants: unknown[] = [];
  const logs: string[] = [];
  const line = (message: string, fields?: object) =>
    void logs.push(`${message} ${JSON.stringify(fields ?? {})}`);
  const log: Logger = { info: line, warn: line, error: line };
  db.reads = [];
  const handlers = realtimeHandlers({
    emitter: {
      emit: (rooms, name, packet) => (
        sent.push({ rooms, event: name, packet: packet as Record<string, unknown> }),
        Promise.resolve()
      ),
    },
    read: (t, fn) => (tenants.push(t), fn({} as TenantTx)),
    log,
  });
  const run = (e: EventJobData) => {
    const handler = handlers[e.type];
    if (!handler) throw new Error(`no handler for ${e.type}`);
    return handler(e, tenant);
  };
  return { run, sent, tenants, logs, handlers };
}

describe('message.created', () => {
  it('sends the whole message to the room of the conversation, and a summary WITHOUT its content to the workspace', async () => {
    db.message = {
      id: M,
      conversationId: C,
      sequenceNumber: 7,
      senderKind: 'customer',
      senderUserId: null,
      kind: 'text',
      body: 'xin chào',
      platformSentAt: new Date('2026-10-21T09:59:59.000Z'),
      createdAt: new Date('2026-10-21T10:00:00.000Z'),
    };
    const t = setup();
    await t.run(
      event('message.created', { conversationId: C, messageId: M, sequenceNumber: 7 }, null),
    );
    expect(t.tenants).toEqual([tenant]);
    expect(t.sent.map((s) => [s.rooms, s.event])).toEqual([
      [[`conv:${C}`], 'message.created'],
      [[`ws:${WS}`], 'message.created'],
    ]);
    expect(t.sent[0]?.packet).toEqual({
      eventId: 'ev-1',
      type: 'message.created',
      version: 1,
      occurredAt: '2026-10-21T10:00:00.000Z',
      traceId: 'trace-1',
      aggregateVersion: null,
      data: {
        conversationId: C,
        messageId: M,
        sequenceNumber: 7,
        senderKind: 'customer',
        senderUserId: null,
        kind: 'text',
        body: 'xin chào',
        platformSentAt: '2026-10-21T09:59:59.000Z',
        createdAt: '2026-10-21T10:00:00.000Z',
      },
    });
    expect(t.sent[1]?.packet['data']).toEqual({
      conversationId: C,
      sequenceNumber: 7,
      senderKind: 'customer',
      createdAt: '2026-10-21T10:00:00.000Z',
    });
    expect(JSON.stringify(t.sent[1])).not.toContain('xin chào');
    expect(t.logs).toEqual([
      `event_consumed {"eventId":"ev-1","type":"message.created","orgId":"${ORG}","workspaceId":"${WS}"}`,
    ]);
  });

  it('sends nothing for a message it cannot read, and says so by its id', async () => {
    db.message = null;
    const t = setup();
    await t.run(event('message.created', { conversationId: C, messageId: M }));
    expect(t.sent).toEqual([]);
    expect(t.logs).toEqual([`event_message_missing {"eventId":"ev-1","messageId":"${M}"}`]);
  });

  it('fails for good an event without the ids it needs', async () => {
    await expect(setup().run(event('message.created', { conversationId: C }))).rejects.toEqual(
      new PermanentEventError('E_BAD_PAYLOAD'),
    );
  });
});

describe('conversation.state_changed', () => {
  it('sends the change with its version and the current assignee to the conversation and the workspace', async () => {
    db.view = { assignedUserId: U1 };
    const t = setup();
    await t.run(
      event('conversation.state_changed', {
        conversationId: C,
        from: 'HUMAN_WAITING_Q',
        to: 'HUMAN_ACTIVE',
        hold: false,
      }),
    );
    expect(t.sent).toEqual([
      expect.objectContaining({
        rooms: [`conv:${C}`, `ws:${WS}`],
        event: 'conversation.state_changed',
        packet: expect.objectContaining({
          aggregateVersion: 4,
          data: {
            conversationId: C,
            from: 'HUMAN_WAITING_Q',
            to: 'HUMAN_ACTIVE',
            hold: false,
            version: 4,
            assignedUserId: U1,
          },
        }) as unknown,
      }),
    ]);
  });
});

describe('conversation.assigned, agent.transferred and agent.reassigned', () => {
  it('tell the new holder, the previous one and the workspace, as one packet', async () => {
    const t = setup();
    await t.run(event('conversation.assigned', { conversationId: C, assignedUserId: U1 }));
    await t.run(event('agent.transferred', { conversationId: C, fromUserId: U1, toUserId: U2 }));
    await t.run(event('agent.reassigned', { conversationId: C, fromUserId: U2, toUserId: U2 }));
    expect(t.sent.map((s) => [s.rooms, s.event, s.packet['data']])).toEqual([
      [
        [`user:${U1}`, `ws:${WS}`],
        'conversation.assigned',
        { conversationId: C, assignedUserId: U1, previousUserId: null },
      ],
      [
        [`user:${U2}`, `user:${U1}`, `ws:${WS}`],
        'conversation.assigned',
        { conversationId: C, assignedUserId: U2, previousUserId: U1 },
      ],
      [
        [`user:${U2}`, `ws:${WS}`],
        'conversation.assigned',
        { conversationId: C, assignedUserId: U2, previousUserId: U2 },
      ],
    ]);
    expect(db.reads).toEqual([]);
  });

  it('still logs conversation.created, which has no packet of its own', async () => {
    const t = setup();
    await t.run(event('conversation.created', { conversationId: C }));
    expect(t.sent).toEqual([]);
    expect(t.logs[0]).toMatch(/^event_consumed /);
  });
});
