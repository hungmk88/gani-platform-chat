import { randomUUID } from 'node:crypto';

import { createDbPool, type TenantContext } from '@gani/db';
import { snapshotViolations, type ConversationState } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../database/database.service.js';
import { ConversationStateMachine, conversationStore } from './conversation-state-machine.js';
import { ConversationAlreadyClaimedError, ConversationNotFoundError } from './errors.js';
import { MessageService } from './message-service.js';

// PR4b-2 (N96, N107) on PostgreSQL with the real stores and the pool of app_role: a customer message and the state change it causes are
// one transaction (rollback), the numbers and the state hold under 20 messages and some claims at once (no deadlock, G8), and the
// reopen window at its edge. Needs a database, so it runs in the `db` job of CI and not on a dev machine.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [A, WA, WB] = [randomUUID(), randomUUID(), randomUUID()];
const AGENTS = Array.from({ length: 4 }, () => randomUUID());
const NOW = new Date('2026-10-06T12:00:00Z');
const [MINUTE, HOUR] = [60_000, 3_600_000];
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const db = new DatabaseService(need('DATABASE_URL_APP'), (url, options) =>
  createDbPool(url, { ...options, max: 30 }),
);
const fsm = new ConversationStateMachine();
const service = new MessageService(fsm);
const ctx = (workspaceIds: string[]): TenantContext => ({ orgId: A, workspaceIds });
const by = (agent: string, n = 0) => ({
  actor: { kind: 'agent', id: agent } as const,
  traceId: `t-${n}`,
});
const errorCodes = (reason: unknown): string[] => {
  const found: string[] = [];
  for (let e = reason; e instanceof Error; e = e.cause)
    if ('code' in e && typeof e.code === 'string') found.push(e.code);
  return found;
};

/** A conversation held by an agent who waits for the customer: created, queued, claimed, then PENDING_CUSTOMER (version 3). */
async function pendingCustomer(workspace = WA): Promise<string> {
  const agent = AGENTS[0] as string;
  const step = <T>(fn: Parameters<typeof db.withTenant<T>>[1]) =>
    db.withTenant(ctx([workspace]), fn);
  const created = await step((tx) =>
    fsm.create(tx, { workspaceId: workspace, actor: { kind: 'bot' }, traceId: 'c' }),
  );
  const id = created.kind === 'changed' ? created.conversation.id : '';
  await step((tx) =>
    fsm.transition(
      tx,
      id,
      { type: 'needs_human', inHours: true },
      { actor: { kind: 'bot' }, traceId: 'q' },
    ),
  );
  await step((tx) => fsm.transition(tx, id, { type: 'claim', userId: agent }, by(agent, 1)));
  await step((tx) =>
    fsm.transition(
      tx,
      id,
      { type: 'agent_waits_customer' },
      { ...by(agent, 2), expectedVersion: 2 },
    ),
  );
  return id;
}
async function closedConversation(closedAt: Date): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "INSERT INTO conversations (id, org_id, workspace_id, state, closed_at, outcome) VALUES ($1, $2, $3, 'CLOSED', $4, 'resolved')",
    [id, A, WA, closedAt],
  );
  return id;
}
const receive = (
  svc: MessageService,
  id: string,
  agentOnline: boolean,
  over: { now?: Date; traceId?: string } = {},
) =>
  db.withTenant(ctx([WA]), (tx) =>
    svc.receiveCustomerMessage(tx, {
      conversationId: id,
      kind: 'text',
      body: 'hello',
      traceId: 't',
      agentOnline,
      ...over,
    }),
  );

interface Snapshot {
  messages: number;
  outbox: number;
  messageCreated: number;
  events: number;
  state: string;
  version: number;
  assigned: string | null;
  closedAt: string | null;
  lastMessageAt: string | null;
  lastCustomerAt: string | null;
}
/** Everything a message and its state change touch, read as the administrator. */
async function snapshot(id: string): Promise<Snapshot> {
  const count = async (sql: string) =>
    (await admin.query<{ n: number }>(sql, [id])).rows[0]?.n as number;
  const row = (
    await admin.query<{
      state: string;
      version: number;
      assigned: string | null;
      closed: Date | null;
      last: Date | null;
      customer: Date | null;
    }>(
      `SELECT state, version, assigned_user_id AS assigned, closed_at AS closed, last_message_at AS last, last_customer_message_at AS customer
       FROM conversations WHERE id = $1`,
      [id],
    )
  ).rows[0];
  return {
    messages: await count('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1'),
    outbox: await count('SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1'),
    messageCreated: await count(
      "SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'message.created'",
    ),
    events: await count(
      'SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id = $1',
    ),
    state: row?.state as string,
    version: row?.version as number,
    assigned: row?.assigned ?? null,
    closedAt: row?.closed?.toISOString() ?? null,
    lastMessageAt: row?.last?.toISOString() ?? null,
    lastCustomerAt: row?.customer?.toISOString() ?? null,
  };
}
/** `n` callers wait at the gate; the last to arrive opens it for all. */
function gate(n: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return () => {
    if (++arrived === n) open();
    return opened;
  };
}

beforeAll(async () => {
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    A,
    `t-${A}`,
    'T',
  ]);
  await admin.query(
    `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $3, 'wa', 'WA', 'service'), ($2, $3, 'wb', 'WB', 'service')`,
    [WA, WB, A],
  );
  await admin.query(
    `INSERT INTO users (id, email, status) SELECT u, u::text || '@example.test', 'active' FROM unnest($1::uuid[]) AS u`,
    [AGENTS],
  );
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) SELECT gen_random_uuid(), $2, u, 'sales', 'active' FROM unnest($1::uuid[]) AS u`,
    [AGENTS, A],
  );
});

afterAll(async () => {
  // Children first; a failing step is swallowed because the CI database is thrown away after the job.
  for (const [text, params] of [
    ['DELETE FROM outbox_events WHERE org_id = $1', [A]],
    ['DELETE FROM conversation_events WHERE org_id = $1', [A]],
    ['DELETE FROM messages WHERE org_id = $1', [A]],
    ['DELETE FROM conversations WHERE org_id = $1', [A]],
    ['DELETE FROM org_members WHERE org_id = $1', [A]],
    ['DELETE FROM workspaces WHERE org_id = $1', [A]],
    ['DELETE FROM organizations WHERE id = $1', [A]],
    ['DELETE FROM users WHERE id = ANY($1::uuid[])', [AGENTS]],
  ] as const)
    await admin.query(text, [...params]).catch(() => undefined);
  await Promise.all([admin.end(), db.onApplicationShutdown()]);
});

describe('one transaction: the message, its outbox row and its state change stand or fall together', () => {
  it('leaves nothing behind when the last write of the state machine fails, and writes all of it when it does not', async () => {
    const failing = new MessageService(
      new ConversationStateMachine({
        ...conversationStore,
        insertConversationEvent: () => Promise.reject(new Error('stop')),
      }),
    );
    const id = await pendingCustomer();
    const before = await snapshot(id);
    expect(before).toMatchObject({
      messages: 0,
      messageCreated: 0,
      state: 'PENDING_CUSTOMER',
      version: 3,
      lastMessageAt: null,
      lastCustomerAt: null,
    });

    // The failing write comes last: the message, message.created, both marks, the new state and the outbox of the state machine were already written.
    await expect(receive(failing, id, false)).rejects.toThrow('stop');
    const after = await snapshot(id);
    expect(after.messages).toBe(0);
    expect(after.messageCreated).toBe(0);
    expect(after.events).toBe(before.events);
    expect(after.outbox).toBe(before.outbox);
    expect(after).toEqual(before);

    // The same conversation with the real state machine: everything the failed run could have left is now there, so the zeros above mean something.
    const result = await receive(service, id, false);
    expect(result.outcome).toMatchObject({ kind: 'changed', transition: 'T11' });
    const done = await snapshot(id);
    expect(done).toMatchObject({
      messages: 1,
      messageCreated: 1,
      state: 'HUMAN_WAITING_Q',
      version: 4,
      assigned: null,
    });
    expect(done.events).toBe(before.events + 1);
    expect(done.outbox).toBe(before.outbox + 2);
    expect(done.lastMessageAt).not.toBeNull();
    expect(done.lastCustomerAt).not.toBeNull();
  });

  it('writes the message, message.created (references only), the history and the outbox of the change, and both marks', async () => {
    const id = await pendingCustomer();
    const { message } = await receive(service, id, false, { traceId: 'trace-ok' });
    const outbox = await admin.query<{
      event_type: string;
      aggregate_version: number | null;
      actor_kind: string;
      workspace_id: string;
      payload: Record<string, unknown>;
      trace_id: string;
    }>(
      `SELECT event_type, aggregate_version, actor_kind, workspace_id, payload, trace_id FROM outbox_events
       WHERE aggregate_id = $1 AND (event_type = 'message.created' OR (event_type = 'conversation.state_changed' AND aggregate_version = 4))
       ORDER BY event_type`,
      [id],
    );
    expect(outbox.rows).toMatchObject([
      {
        event_type: 'conversation.state_changed',
        aggregate_version: 4,
        actor_kind: 'customer',
        workspace_id: WA,
      },
      {
        event_type: 'message.created',
        aggregate_version: null,
        actor_kind: 'customer',
        workspace_id: WA,
        trace_id: 'trace-ok',
      },
    ]);
    expect(outbox.rows[1]?.payload).toEqual({
      conversationId: id,
      messageId: message.id,
      sequenceNumber: 1,
    });
    const stored = await admin.query(
      'SELECT sequence_number::int AS n, sender_kind, kind FROM messages WHERE conversation_id = $1',
      [id],
    );
    expect(stored.rows).toEqual([{ n: 1, sender_kind: 'customer', kind: 'text' }]);
    const event = await admin.query<{ event_type: string; actor_kind: string; trace_id: string }>(
      'SELECT event_type, actor_kind, trace_id FROM conversation_events WHERE conversation_id = $1 AND version_after = 4',
      [id],
    );
    expect(event.rows).toEqual([
      { event_type: 'state_changed', actor_kind: 'customer', trace_id: 'trace-ok' },
    ]);
  });
});

describe('the state a customer message leads to', () => {
  it('T10 with an agent online keeps the agent; T11 with none sends the conversation to the queue', async () => {
    const [online, away] = [await pendingCustomer(), await pendingCustomer()];
    expect((await receive(service, online, true)).outcome).toMatchObject({ transition: 'T10' });
    expect((await receive(service, away, false)).outcome).toMatchObject({ transition: 'T11' });
    expect(await snapshot(online)).toMatchObject({
      state: 'HUMAN_ACTIVE',
      assigned: AGENTS[0],
      version: 4,
    });
    expect(await snapshot(away)).toMatchObject({
      state: 'HUMAN_WAITING_Q',
      assigned: null,
      version: 4,
    });
  });

  it.each([
    ['71h59m', 72 * HOUR - MINUTE, true],
    ['72h00m00s (the limit counts)', 72 * HOUR, true],
    ['72h01m', 72 * HOUR + MINUTE, false],
  ])(
    'closed %s before the message: reopened is %s, and the message is stored either way',
    async (_label, ago, reopened) => {
      const closedAt = new Date(NOW.getTime() - ago);
      const id = await closedConversation(closedAt);
      const { outcome } = await receive(service, id, false, { now: NOW });
      const s = await snapshot(id);
      if (reopened) {
        expect(outcome).toMatchObject({ kind: 'changed', transition: 'T14' });
        expect(s).toMatchObject({ state: 'BOT_ACTIVE', closedAt: null, version: 1 });
      } else {
        expect(outcome).toEqual({ kind: 'unchanged', reason: 'reopen_window_passed' });
        expect(s).toMatchObject({ state: 'CLOSED', closedAt: closedAt.toISOString(), version: 0 });
      }
      expect(s).toMatchObject({ messages: 1, messageCreated: 1 });
    },
  );
});

describe('20 customer messages and some claims at once (the lock order, G8)', () => {
  it('numbers the messages 1..20, deadlocks nowhere and leaves a state the table accepts, five times', async () => {
    for (let round = 0; round < 5; round++) {
      const id = await pendingCustomer();
      const start = gate(23);
      const customers = Array.from({ length: 20 }, (_, n) =>
        db.withTenant(ctx([WA]), async (tx) => {
          await start();
          return service.receiveCustomerMessage(tx, {
            conversationId: id,
            kind: 'text',
            body: `m${n}`,
            traceId: `r${round}-${n}`,
            agentOnline: false,
          });
        }),
      );
      const claims = AGENTS.slice(1).map((agent, n) =>
        db.withTenant(ctx([WA]), async (tx) => {
          await start();
          return fsm.transition(tx, id, { type: 'claim', userId: agent }, by(agent, n));
        }),
      );
      const results = await Promise.allSettled([...customers, ...claims]);

      const codes = results.flatMap((r) => (r.status === 'rejected' ? errorCodes(r.reason) : []));
      expect(
        codes.filter((c) => c === '40P01' || c === '40001'),
        `round ${round}`,
      ).toEqual([]);
      const sent = results.slice(0, 20);
      expect(sent.every((r) => r.status === 'fulfilled')).toBe(true);
      const numbers = sent.flatMap((r) =>
        r.status === 'fulfilled' && 'message' in r.value ? [r.value.message.sequenceNumber] : [],
      );
      expect(numbers.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      const lost = results
        .slice(20)
        .flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
      for (const reason of lost) expect(reason).toBeInstanceOf(ConversationAlreadyClaimedError);

      const s = await snapshot(id);
      expect(['HUMAN_WAITING_Q', 'HUMAN_ACTIVE']).toContain(s.state);
      const state = s.state as ConversationState;
      expect(
        snapshotViolations({
          state,
          afterHoursHold: false,
          assignedUserId: s.assigned,
          closedAt: null,
          outcome: null,
        }),
      ).toEqual([]);
      expect(s.version).toBe(s.events - 1);
      expect(s).toMatchObject({ messages: 20, messageCreated: 20 });
      expect(s.lastMessageAt).not.toBeNull();
      expect(s.lastCustomerAt).not.toBeNull();
    }
  });
});

describe('a conversation of another workspace', () => {
  it('is not found, and leaves no message and no outbox row', async () => {
    const other = await pendingCustomer(WB);
    const before = await snapshot(other);
    await expect(receive(service, other, true)).rejects.toThrow(ConversationNotFoundError);
    expect(await snapshot(other)).toEqual(before);
    expect(before.messages).toBe(0);
  });
});
