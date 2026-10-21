import type { TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { currentRequestContext } from '../request-context/request-context.js';
import { MAX_CONVERSATION_ROOMS, registerAgentEvents, type AgentSocket } from './agent-events.js';
import type { AgentContext } from './handshake.js';

const C = '0197a3c0-0000-7000-8000-00000000000c';
const ctx: AgentContext = {
  userId: 'u1',
  orgId: 'o1',
  role: 'sales',
  workspaceIds: ['w1'],
  resolvedAt: new Date(0),
  traceId: 't0',
  sessionId: 's1',
  checkedAt: 0,
};
const view = {
  id: C,
  state: 'HUMAN_ACTIVE',
  afterHoursHold: false,
  version: 3,
  assignedUserId: null,
};
const msg = (n: number) => ({
  id: `m${n}`,
  sequenceNumber: n,
  senderKind: 'customer',
  senderUserId: null,
  kind: 'text',
  body: 'x',
  platformSentAt: null,
  createdAt: new Date(0),
});

// The database is a fake tx whose queries are recorded with the joins of the socket, so the order of §5 can be seen.
const db = vi.hoisted(() => {
  const state: {
    order: string[];
    view: unknown;
    page: { rows: unknown[]; hasMore: boolean; maxSequence: number };
  } = { order: [], view: null, page: { rows: [], hasMore: false, maxSequence: 0 } };
  return state;
});
vi.mock('@gani/db', () => ({
  RESUME_PAGE_MAX: 200,
  loadConversationView: vi.fn(() => (db.order.push('load'), Promise.resolve(db.view))),
  listMessagesAfter: vi.fn(() => (db.order.push('messages'), Promise.resolve(db.page))),
}));

function setup(o: { fresh?: boolean; now?: () => number } = {}) {
  db.order = [];
  db.view = view;
  db.page = { rows: [msg(4), msg(5)], hasMore: false, maxSequence: 5 };
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const rooms = new Set<string>();
  const socket: AgentSocket = {
    id: 'sock',
    data: { ctx },
    rooms,
    join: (room: string) => (db.order.push(`join ${room}`), rooms.add(room)),
    leave: (room: string) => rooms.delete(room),
    on: (event, listener) => handlers.set(event, listener),
  };
  const tenants: unknown[] = [];
  registerAgentEvents(socket, {
    withTenant: (tenant, fn) => {
      tenants.push({ tenant, request: currentRequestContext().userId });
      return fn({} as TenantTx);
    },
    ensureFresh: () => Promise.resolve(o.fresh ?? true),
    log: { warn: () => undefined },
    ...(o.now ? { now: o.now } : {}),
  });
  const ask = (event: string, args: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => handlers.get(event)?.(args, resolve));
  return { ask, rooms, tenants, handlers };
}

describe('conversation.subscribe and unsubscribe', () => {
  it('joins the room of a conversation the person may see, in the tenant and the request context of the socket', async () => {
    const t = setup();
    expect(await t.ask('conversation.subscribe', { conversationId: C })).toEqual({ ok: true });
    expect([...t.rooms]).toEqual([`conv:${C}`]);
    expect(t.tenants).toEqual([{ tenant: { orgId: 'o1', workspaceIds: ['w1'] }, request: 'u1' }]);
    expect(await t.ask('conversation.unsubscribe', { conversationId: C })).toEqual({ ok: true });
    expect([...t.rooms]).toEqual([]);
  });

  it('answers not_found alike for an id RLS hides and for one assigned to somebody else', async () => {
    for (const hidden of [null, { ...view, assignedUserId: 'u2' }]) {
      const t = setup();
      db.view = hidden;
      expect(await t.ask('conversation.subscribe', { conversationId: C })).toMatchObject({
        ok: false,
        code: 'not_found',
      });
      expect(t.rooms.size).toBe(0);
    }
  });

  it('refuses a malformed request, a 21st conversation, and a socket whose session ended; ignores an event without an ack', async () => {
    const t = setup();
    expect(await t.ask('conversation.subscribe', { conversationId: 'x' })).toMatchObject({
      code: 'validation_failed',
    });
    for (let n = 0; n < MAX_CONVERSATION_ROOMS; n++) t.rooms.add(`conv:${n}`);
    expect(await t.ask('conversation.subscribe', { conversationId: C })).toMatchObject({
      code: 'rate_limited',
    });
    expect(
      await setup({ fresh: false }).ask('conversation.subscribe', { conversationId: C }),
    ).toMatchObject({ code: 'unauthorized' });
    expect(() => t.handlers.get('conversation.subscribe')?.({ conversationId: C })).not.toThrow();
  });
});

describe('resume', () => {
  it('joins the room BEFORE it reads the messages, and answers the snapshot and the page', async () => {
    const t = setup();
    const answer = await t.ask('resume', { conversationId: C, lastSequenceNumber: 3 });
    expect(db.order).toEqual(['load', `join conv:${C}`, 'load', 'messages']);
    expect(answer).toMatchObject({
      ok: true,
      conversation: { id: C, state: 'HUMAN_ACTIVE', hold: false, version: 3, assignedUserId: null },
      hasMore: false,
      resync: false,
    });
    expect(
      (answer['messages'] as { sequenceNumber: number }[]).map((m) => m.sequenceNumber),
    ).toEqual([4, 5]);
  });

  it('asks for a resync, with no messages, when the client is ahead of the server', async () => {
    const answer = await setup().ask('resume', { conversationId: C, lastSequenceNumber: 9 });
    expect(answer).toMatchObject({ ok: true, messages: [], hasMore: false, resync: true });
  });

  it('allows 10 calls in 10 seconds, then rate_limited, then again once the window has passed', async () => {
    let clock = 0;
    const t = setup({ now: () => clock });
    for (let n = 0; n < 10; n++)
      expect(await t.ask('resume', { conversationId: C, lastSequenceNumber: 0 })).toMatchObject({
        ok: true,
      });
    expect(await t.ask('resume', { conversationId: C, lastSequenceNumber: 0 })).toMatchObject({
      code: 'rate_limited',
    });
    clock = 10_000;
    expect(await t.ask('resume', { conversationId: C, lastSequenceNumber: 0 })).toMatchObject({
      ok: true,
    });
  });

  it('answers a failure of the database as internal_error with a traceId only', async () => {
    const t = setup();
    db.view = undefined;
    const { loadConversationView } = await import('@gani/db');
    vi.mocked(loadConversationView).mockRejectedValueOnce(
      new Error('password authentication failed'),
    );
    const answer = await t.ask('resume', { conversationId: C, lastSequenceNumber: 0 });
    expect(answer).toEqual({
      ok: false,
      code: 'internal_error',
      traceId: expect.any(String) as string,
    });
  });
});
