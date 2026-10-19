import { randomUUID } from 'node:crypto';

import {
  createDbPool,
  type ConversationRow,
  type TenantContext,
  type TransitionWrite,
} from '@gani/db';
import { InvalidTransitionError, snapshotViolations, type ConversationState } from '@gani/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../database/database.service.js';
import {
  ConversationStateMachine,
  conversationStore,
  type ConversationStore,
  type TransitionOutcome,
} from './conversation-state-machine.js';
import { ConversationAlreadyClaimedError, ConversationNotFoundError } from './errors.js';

// M1.2 PR2c-3 (N96) on PostgreSQL with the real store and the pool of app_role: the claim race (CLAUDE.md: claim-race.spec), the
// whole life of a conversation, atomicity and isolation. Needs a database, so it runs in the `db` job of CI and not on a dev machine.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [A, WA, WB] = [randomUUID(), randomUUID(), randomUUID()];
const AGENTS = Array.from({ length: 50 }, () => randomUUID());
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const db = new DatabaseService(need('DATABASE_URL_APP'), (url, options) =>
  createDbPool(url, { ...options, max: AGENTS.length }),
);
const fsm = new ConversationStateMachine();
const ctx = (workspaceIds: string[], orgId = A): TenantContext => ({ orgId, workspaceIds });
const by = (agent: string, n = 0) => ({
  actor: { kind: 'agent', id: agent } as const,
  traceId: `trace-${n}`,
});
const sqlState = async (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => {
      for (let c = e; c instanceof Error; c = c.cause)
        if ('code' in c && typeof c.code === 'string') return c.code;
      return 'none';
    },
  );

const create = (workspace = WA) =>
  db.withTenant(ctx([workspace]), (tx) =>
    fsm.create(tx, { workspaceId: workspace, ...by(AGENTS[0] as string) }),
  );
const idOf = (out: TransitionOutcome): string =>
  out.kind === 'changed' ? out.conversation.id : '';
/** A conversation that waits in the queue (created, then the bot asks for a person during working hours). */
async function waiting(): Promise<string> {
  const id = idOf(await create());
  await db.withTenant(ctx([WA]), (tx) =>
    fsm.transition(
      tx,
      id,
      { type: 'needs_human', inHours: true },
      { actor: { kind: 'bot' }, traceId: 'q' },
    ),
  );
  return id;
}
/** A conversation the bot holds after hours: created, then the bot asks for a person outside working hours (T03). */
async function holding(): Promise<string> {
  const id = idOf(await create());
  await db.withTenant(ctx([WA]), (tx) =>
    fsm.transition(
      tx,
      id,
      { type: 'needs_human', inHours: false },
      { actor: { kind: 'bot' }, traceId: 'h' },
    ),
  );
  return id;
}
const stored = async (id: string) =>
  (
    await admin.query<{
      state: string;
      version: number;
      assigned_user_id: string | null;
      closed_at: Date | null;
      outcome: string | null;
      after_hours_hold: boolean;
    }>(
      'SELECT state, version, assigned_user_id, closed_at, outcome, after_hours_hold FROM conversations WHERE id = $1',
      [id],
    )
  ).rows[0];
const outboxOf = async (id: string) =>
  (
    await admin.query<{
      event_type: string;
      aggregate_version: number;
      payload: Record<string, unknown>;
      workspace_id: string;
    }>(
      'SELECT event_type, aggregate_version, payload, workspace_id FROM outbox_events WHERE aggregate_id = $1 ORDER BY aggregate_version, id',
      [id],
    )
  ).rows;
const eventsOf = async (id: string) =>
  (
    await admin.query<Record<string, unknown>>(
      `SELECT event_type, from_state, to_state, from_hold, to_hold, actor_kind, actor_id, version_after, outcome, trace_id, detail
     FROM conversation_events WHERE conversation_id = $1 ORDER BY version_after, occurred_at`,
      [id],
    )
  ).rows;

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
    ['DELETE FROM conversations WHERE org_id = $1', [A]],
    ['DELETE FROM org_members WHERE org_id = $1', [A]],
    ['DELETE FROM workspaces WHERE org_id = $1', [A]],
    ['DELETE FROM organizations WHERE id = $1', [A]],
    ['DELETE FROM users WHERE id = ANY($1::uuid[])', [AGENTS]],
  ] as const)
    await admin.query(text, [...params]).catch(() => undefined);
  await Promise.all([admin.end(), db.onApplicationShutdown()]);
});

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

/** 50 agents claim one conversation: all start together, and all have read it before any of them writes. */
async function claimRace(store: ConversationStore, id: string) {
  const [start, read] = [gate(AGENTS.length), gate(AGENTS.length)];
  const machine = new ConversationStateMachine({
    ...store,
    loadConversation: async (tx, conversationId) => {
      const row = await store.loadConversation(tx, conversationId);
      await read();
      return row;
    },
  });
  return Promise.allSettled(
    AGENTS.map((agent, n) =>
      db.withTenant(ctx([WA]), async (tx) => {
        await start();
        return machine.transition(tx, id, { type: 'claim', userId: agent }, by(agent, n));
      }),
    ),
  );
}
type Changed = Extract<TransitionOutcome, { kind: 'changed' }>;
const wins = (results: PromiseSettledResult<TransitionOutcome>[]): Changed[] =>
  results.flatMap((r) => (r.status === 'fulfilled' && r.value.kind === 'changed' ? [r.value] : []));

/** A store whose UPDATE tests only `id` and what `where` adds: a mutant of `applyTransition` (a test proves nothing until it goes red). */
const mutantStore = (where: (w: TransitionWrite) => string): ConversationStore => ({
  ...conversationStore,
  applyTransition: async (tx, w) => {
    await tx.execute(`SELECT set_config('app.fsm', 'on', true)`);
    const next = w.next;
    const result =
      await tx.execute(`UPDATE conversations SET state = '${next.state}', assigned_user_id = '${String(next.assignedUserId)}',
          version = version + 1 WHERE id = '${w.id}' ${where(w)} RETURNING id, org_id, workspace_id, state, version, assigned_user_id, after_hours_hold, closed_at, outcome`);
    await tx.execute(`SELECT set_config('app.fsm', 'off', true)`);
    const r = result.rows[0];
    if (!r) return null;
    return {
      id: r['id'],
      orgId: r['org_id'],
      workspaceId: r['workspace_id'],
      state: r['state'],
      version: r['version'],
      assignedUserId: r['assigned_user_id'],
      afterHoursHold: r['after_hours_hold'],
      closedAt: r['closed_at'],
      outcome: r['outcome'],
    } as ConversationRow;
  },
});

describe('claim-race: 50 agents claim one conversation at once', () => {
  it('exactly one wins, the other 49 are told who holds it, and the history has one claim', async () => {
    const id = await waiting();
    const results = await claimRace(conversationStore, id);
    const [won] = wins(results);
    const winner = won?.conversation.snapshot.assignedUserId;
    expect(wins(results)).toHaveLength(1);
    expect(winner).toEqual(expect.any(String));
    const lost = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    expect(lost).toHaveLength(AGENTS.length - 1);
    for (const reason of lost) expect(reason).toBeInstanceOf(ConversationAlreadyClaimedError);
    for (const reason of lost)
      expect(reason).toMatchObject({
        code: 'conversation_already_claimed',
        assignedUserId: winner,
      });
    expect(await stored(id)).toMatchObject({
      state: 'HUMAN_ACTIVE',
      assigned_user_id: winner,
      version: 2,
    });
    expect((await eventsOf(id)).filter((e) => e['event_type'] === 'claimed')).toHaveLength(1);
  });

  it('runs under READ COMMITTED, which the claim relies on (no Redlock)', async () => {
    const { rows } = await admin.query<{ level: string }>(
      "SELECT current_setting('default_transaction_isolation') AS level",
    );
    expect(rows[0]?.level).toBe('read committed');
  });

  // Mutation: the same race with the UPDATE that forgets "state = from" must be caught, or the test above proves nothing.
  it('goes red when the UPDATE drops its state condition: every agent "wins"', async () => {
    const mutant = mutantStore(() => '');
    expect(wins(await claimRace(mutant, await waiting())).length).toBeGreaterThan(1);
  });
});

describe('claim-race on a conversation the bot holds after hours (T06, FSM spec §9.2)', () => {
  it('exactly one wins, the other 49 are told who holds it, and the hold is released with the claim', async () => {
    const id = await holding();
    expect(await stored(id)).toMatchObject({
      state: 'BOT_ACTIVE',
      after_hours_hold: true,
      version: 1,
    });
    const results = await claimRace(conversationStore, id);
    const [won] = wins(results);
    const winner = won?.conversation.snapshot.assignedUserId;
    expect(wins(results)).toHaveLength(1);
    expect(won).toMatchObject({ transition: 'T06' });
    const lost = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    expect(lost).toHaveLength(AGENTS.length - 1);
    for (const reason of lost) expect(reason).toBeInstanceOf(ConversationAlreadyClaimedError);
    expect(await stored(id)).toMatchObject({
      state: 'HUMAN_ACTIVE',
      assigned_user_id: winner,
      after_hours_hold: false,
      version: 2,
    });
    const claims = (await eventsOf(id)).filter((e) => e['event_type'] === 'claimed');
    expect(claims).toMatchObject([{ from_hold: true, to_hold: false, version_after: 2 }]);
    const assigned = (await outboxOf(id)).filter((e) => e.event_type === 'conversation.assigned');
    expect(assigned).toHaveLength(1);
  });

  it('keeps whatever the table allows when 25 claims race one release after hours (T06 against T08)', async () => {
    const id = await holding();
    const start = gate(26);
    const claims = AGENTS.slice(0, 25).map((agent, n) =>
      db.withTenant(ctx([WA]), async (tx) => {
        await start();
        return fsm.transition(tx, id, { type: 'claim', userId: agent }, by(agent, n));
      }),
    );
    const release = db.withTenant(ctx([WA]), async (tx) => {
      await start();
      const event = { type: 'release_after_hours', inHours: true } as const;
      return fsm.transition(tx, id, event, { actor: { kind: 'system' }, traceId: 't08' });
    });
    const results = await Promise.allSettled([...claims, release]);
    const claimed = wins(results.slice(0, 25));
    expect(claimed.length).toBeLessThanOrEqual(1);
    // A claim that loses is always "already claimed"; a release that loses finds the conversation held and the table has no row for it.
    for (const r of results.slice(0, 25))
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConversationAlreadyClaimedError);
    const released = results[25];
    if (released?.status === 'rejected')
      expect(released.reason).toBeInstanceOf(InvalidTransitionError);
    expect(claimed.length + wins(results.slice(25)).length).toBeGreaterThan(0);
    const now = await stored(id);
    expect(['HUMAN_WAITING_Q', 'HUMAN_ACTIVE']).toContain(now?.state);
    expect(
      snapshotViolations({
        state: now?.state as ConversationState,
        afterHoursHold: now?.after_hours_hold ?? false,
        assignedUserId: now?.assigned_user_id ?? null,
        closedAt: now?.closed_at ?? null,
        outcome: null,
      }),
    ).toEqual([]);
    expect(now?.version).toBe((await eventsOf(id)).length - 1);
  });

  // The hold condition cannot be told from the state condition by any race the table allows (no row leads from BOT_ACTIVE + hold to
  // BOT_ACTIVE without it), so it is staged: the claimer has read "BOT_ACTIVE + hold", and the hold is released behind its back.
  const dropHoldBehindTheBack = (store: ConversationStore, id: string): ConversationStore => {
    let done = false;
    return {
      ...store,
      loadConversation: async (tx, conversationId) => {
        const row = await store.loadConversation(tx, conversationId);
        if (!done) {
          done = true;
          const c = await admin.connect();
          try {
            await c.query('BEGIN');
            await c.query("SELECT set_config('app.fsm', 'on', true)");
            await c.query(
              'UPDATE conversations SET after_hours_hold = false, version = version + 1 WHERE id = $1',
              [id],
            );
            await c.query('COMMIT');
          } finally {
            c.release();
          }
        }
        return row;
      },
    };
  };
  const claimOnce = (store: ConversationStore, id: string) =>
    Promise.allSettled([
      db.withTenant(ctx([WA]), (tx) =>
        new ConversationStateMachine(store).transition(
          tx,
          id,
          { type: 'claim', userId: AGENTS[1] as string },
          by(AGENTS[1] as string),
        ),
      ),
    ]);

  it('does not claim a conversation whose hold went away after it was read: the UPDATE tests the flag too', async () => {
    const id = await holding();
    const [result] = await claimOnce(dropHoldBehindTheBack(conversationStore, id), id);
    expect(result).toMatchObject({ status: 'rejected' });
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
      ConversationAlreadyClaimedError,
    );
    expect(await stored(id)).toMatchObject({
      state: 'BOT_ACTIVE',
      after_hours_hold: false,
      assigned_user_id: null,
    });
  });

  it('goes red when the UPDATE drops its hold condition: a claim wins a conversation nobody holds after hours', async () => {
    const id = await holding();
    const mutant = mutantStore((w) => `AND state = '${w.from.state}'`);
    const [result] = await claimOnce(dropHoldBehindTheBack(mutant, id), id);
    expect(result).toMatchObject({ status: 'fulfilled' });
    expect(await stored(id)).toMatchObject({ state: 'HUMAN_ACTIVE', after_hours_hold: false });
  });
});

describe('the life of a conversation, event by event', () => {
  it('goes from the first message to the close and leaves one event per step', async () => {
    const id = idOf(await create());
    const [agent] = AGENTS as [string];
    const step = (
      event: Parameters<ConversationStateMachine['transition']>[2],
      who: Parameters<ConversationStateMachine['transition']>[3],
    ) => db.withTenant(ctx([WA]), (tx) => fsm.transition(tx, id, event, who));
    await step({ type: 'needs_human', inHours: true }, { actor: { kind: 'bot' }, traceId: 't1' });
    await step({ type: 'claim', userId: agent }, by(agent, 2));
    await step({ type: 'agent_waits_customer' }, { ...by(agent, 3), expectedVersion: 2 });
    await step(
      { type: 'customer_message', now: new Date(), agentOnline: true },
      { actor: { kind: 'customer' }, traceId: 't4' },
    );
    await step(
      { type: 'close', now: new Date(), outcome: 'resolved' },
      { ...by(agent, 5), expectedVersion: 4 },
    );
    const events = await eventsOf(id);
    expect(
      events.map((e) => [
        e['event_type'],
        e['from_state'],
        e['to_state'],
        e['version_after'],
        e['actor_kind'],
        (e['detail'] as { transition: string }).transition,
      ]),
    ).toEqual([
      ['created', null, 'BOT_ACTIVE', 0, 'agent', 'T01'],
      ['state_changed', 'BOT_ACTIVE', 'HUMAN_WAITING_Q', 1, 'bot', 'T02'],
      ['claimed', 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE', 2, 'agent', 'T05'],
      ['state_changed', 'HUMAN_ACTIVE', 'PENDING_CUSTOMER', 3, 'agent', 'T09'],
      ['state_changed', 'PENDING_CUSTOMER', 'HUMAN_ACTIVE', 4, 'customer', 'T10'],
      ['state_changed', 'HUMAN_ACTIVE', 'CLOSED', 5, 'agent', 'T13'],
    ]);
    expect(events[5]).toMatchObject({ outcome: 'resolved', trace_id: 'trace-5', actor_id: agent });
    expect(events[1]).toMatchObject({ actor_id: null, from_hold: false, to_hold: false });
    const outbox = await outboxOf(id);
    expect(outbox.map((e) => [e.event_type, e.aggregate_version])).toEqual([
      ['conversation.created', 0],
      ['conversation.state_changed', 1],
      ['conversation.handoff_requested', 1],
      ['conversation.state_changed', 2],
      ['conversation.assigned', 2],
      ['conversation.state_changed', 3],
      ['conversation.state_changed', 4],
      ['conversation.state_changed', 5],
    ]);
    expect(outbox.every((e) => e.workspace_id === WA)).toBe(true);
    expect(outbox[4]?.payload).toEqual({ conversationId: id, assignedUserId: agent });
    expect(await stored(id)).toMatchObject({
      state: 'CLOSED',
      version: 5,
      assigned_user_id: null,
      outcome: 'resolved',
      after_hours_hold: false,
      closed_at: expect.any(Date) as Date,
    });
  });
});

describe('atomicity and isolation', () => {
  const needsHuman = (machine: ConversationStateMachine, id: string) =>
    db.withTenant(ctx([WA]), (tx) =>
      machine.transition(
        tx,
        id,
        { type: 'needs_human', inHours: true },
        { actor: { kind: 'bot' }, traceId: 'x' },
      ),
    );

  // N96: the effects and the transition are one transaction. The history row is written last, so when it fails the outbox rows
  // already exist inside the transaction; that none is left afterwards is the proof, and `written` shows they did exist.
  it('a failure of the history row takes the outbox rows and the new state back with it', async () => {
    const id = idOf(await create());
    let written = 0;
    const failing = new ConversationStateMachine({
      ...conversationStore,
      insertOutboxEvent: async (tx, event) => {
        await conversationStore.insertOutboxEvent(tx, event);
        written++;
      },
      insertConversationEvent: () => Promise.reject(new Error('event failed')),
    });
    await expect(needsHuman(failing, id)).rejects.toThrow('event failed');
    expect(written).toBe(2);
    expect(await stored(id)).toMatchObject({ state: 'BOT_ACTIVE', version: 0 });
    expect(await eventsOf(id)).toHaveLength(1);
    expect((await outboxOf(id)).map((e) => e.event_type)).toEqual(['conversation.created']);
  });

  it('a failure of an outbox row leaves the state and the history as they were', async () => {
    const id = idOf(await create());
    let calls = 0;
    const failing = new ConversationStateMachine({
      ...conversationStore,
      insertOutboxEvent: (tx, event) =>
        ++calls === 2
          ? Promise.reject(new Error('outbox failed'))
          : conversationStore.insertOutboxEvent(tx, event),
    });
    await expect(needsHuman(failing, id)).rejects.toThrow('outbox failed');
    expect(await stored(id)).toMatchObject({ state: 'BOT_ACTIVE', version: 0 });
    expect(await eventsOf(id)).toHaveLength(1);
    expect(await outboxOf(id)).toHaveLength(1);
  });

  it('a conversation of another workspace or another organisation is not found, and stays as it was', async () => {
    const hidden = idOf(await create(WB));
    const open = (context: TenantContext, id: string) =>
      db.withTenant(context, (tx) =>
        fsm.transition(
          tx,
          id,
          { type: 'needs_human', inHours: true },
          { actor: { kind: 'bot' }, traceId: 'x' },
        ),
      );
    await expect(open(ctx([WA]), hidden)).rejects.toThrow(ConversationNotFoundError);
    await expect(open(ctx([WB], randomUUID()), hidden)).rejects.toThrow(ConversationNotFoundError);
    await expect(open(ctx([WA]), randomUUID())).rejects.toThrow(ConversationNotFoundError);
    expect(await stored(hidden)).toMatchObject({ state: 'BOT_ACTIVE', version: 0 });
  });

  it('cannot create a conversation in a workspace the context does not hold (42501)', async () => {
    expect(
      await sqlState(
        db.withTenant(ctx([WA]), (tx) =>
          fsm.create(tx, { workspaceId: WB, ...by(AGENTS[0] as string) }),
        ),
      ),
    ).toBe('42501');
  });
});
