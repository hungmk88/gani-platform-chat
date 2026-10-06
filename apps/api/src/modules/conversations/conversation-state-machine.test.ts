import type { ConversationRow, NewConversationEvent, TenantTx } from '@gani/db';
import { InvalidTransitionError, type ConversationEvent } from '@gani/domain';
import { describe, expect, it } from 'vitest';

import { ConversationStateMachine, type ConversationStore } from './conversation-state-machine.js';
import {
  ConversationAlreadyClaimedError,
  ConversationContendedError,
  ConversationNotFoundError,
  MissingExpectedVersionError,
  VersionConflictError,
} from './errors.js';

// The state machine against a fake store that behaves like the real one: the same conditional UPDATE, version + 1, null for a miss.
const TX = {} as TenantTx;
const [ID, U1, U2] = ['c-1', 'user-1', 'user-2'];
const OPTS = { actor: { kind: 'agent', id: U2 }, traceId: 'trace-1' } as const;
const NOW = new Date('2026-10-06T00:00:00Z');
const say = (event: ConversationEvent) => event;

// prettier-ignore
const row = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: ID, orgId: 'org', workspaceId: 'w-1', state: 'BOT_ACTIVE', version: 0, assignedUserId: null, afterHoursHold: false, closedAt: null, outcome: null, ...over,
});
const held = (state: 'HUMAN_ACTIVE' | 'PENDING_CUSTOMER') =>
  row({ state, assignedUserId: U1, version: 3 });

// prettier-ignore
function fake(initial: ConversationRow | null) {
  const rows = new Map(initial ? [[ID, initial]] : []);
  const events: NewConversationEvent[] = [];
  const calls = { load: 0, apply: 0 };
  const hooks = { beforeApply: (): void => undefined, misses: 0 };
  const store: ConversationStore = {
    loadConversation: (_tx, id) => (calls.load++, Promise.resolve(rows.get(id) ?? null)),
    insertConversation: (_tx, c) => (rows.set(c.id, row({ ...c })), Promise.resolve(row({ ...c }))),
    insertConversationEvent: (_tx, e) => (events.push(e), Promise.resolve()),
    applyTransition: (_tx, w) => {
      calls.apply++;
      hooks.beforeApply();
      const r = rows.get(w.id);
      const stale = w.expectedVersion !== undefined && r?.version !== w.expectedVersion;
      if (hooks.misses-- > 0 || !r || r.state !== w.from.state || r.afterHoursHold !== w.from.afterHoursHold || stale) return Promise.resolve(null);
      const next = { ...r, ...w.next, version: r.version + 1 };
      return (rows.set(w.id, next), Promise.resolve(next));
    },
  };
  return { machine: new ConversationStateMachine(store), rows, events, calls, hooks };
}
const err = (p: Promise<unknown>) => p.catch((e: unknown) => e);

// prettier-ignore
describe('create and transition', () => {
  it('creates a BOT_ACTIVE conversation at version 0 with its first event (T01)', async () => {
    const { machine, rows, events } = fake(null);
    const out = await machine.create(TX, { workspaceId: 'w-1', ...OPTS });
    expect(out).toMatchObject({ kind: 'changed', transition: 'T01', effects: ['conversation.created'] });
    const [id] = [...rows.keys()];
    expect(events).toMatchObject([{ conversationId: id, eventType: 'created', fromState: null, toState: 'BOT_ACTIVE', toHold: false, versionAfter: 0, detail: { transition: 'T01' } }]);
  });

  it('changes the row, raises the version, writes one event with no PII and returns the effects', async () => {
    const { machine, rows, events } = fake(row());
    const out = await machine.transition(TX, ID, say({ type: 'needs_human', inHours: true }), { actor: { kind: 'bot' }, traceId: 't' });
    expect(out).toMatchObject({ kind: 'changed', transition: 'T02', effects: ['conversation.state_changed', 'conversation.handoff_requested'], conversation: { version: 1, snapshot: { state: 'HUMAN_WAITING_Q' } } });
    expect(rows.get(ID)).toMatchObject({ state: 'HUMAN_WAITING_Q', version: 1 });
    expect(events).toEqual([expect.objectContaining({ eventType: 'state_changed', fromState: 'BOT_ACTIVE', toState: 'HUMAN_WAITING_Q', actorKind: 'bot', actorId: null, versionAfter: 1, traceId: 't', detail: { transition: 'T02' } })]);
  });

  it('is not found for a conversation nobody can see, and refuses a row with a state it does not know', async () => {
    const wait = say({ type: 'agent_waits_customer' });
    await expect(fake(null).machine.transition(TX, ID, wait, OPTS)).rejects.toThrow(ConversationNotFoundError);
    await expect(fake(row({ state: 'LIMBO' })).machine.transition(TX, ID, wait, OPTS)).rejects.toThrow(/does not know/);
  });

  it('writes nothing for an invalid transition and for an event that is not a transition', async () => {
    const { machine, calls, events } = fake(row());
    await expect(machine.transition(TX, ID, say({ type: 'hand_back_to_bot' }), OPTS)).rejects.toThrow(InvalidTransitionError);
    const msg = say({ type: 'customer_message', now: NOW, agentOnline: true });
    expect(await machine.transition(TX, ID, msg, OPTS)).toEqual({ kind: 'unchanged', reason: 'customer_message_keeps_state' });
    expect([calls.apply, events.length]).toEqual([0, 0]);
  });
});

// prettier-ignore
describe('claim', () => {
  const claim = say({ type: 'claim', userId: U2 });

  it('assigns the claimer and ignores a version it was given (T05)', async () => {
    const { machine, rows } = fake(row({ state: 'HUMAN_WAITING_Q', version: 4 }));
    await machine.transition(TX, ID, claim, { ...OPTS, expectedVersion: 0 });
    expect(rows.get(ID)).toMatchObject({ state: 'HUMAN_ACTIVE', assignedUserId: U2, version: 5 });
  });

  it('is already claimed, naming who holds it, when it arrives late or loses the race', async () => {
    for (const state of ['HUMAN_ACTIVE', 'PENDING_CUSTOMER'] as const) {
      const late = await err(fake(held(state)).machine.transition(TX, ID, claim, OPTS));
      expect(late).toMatchObject({ status: 409, code: 'conversation_already_claimed', assignedUserId: U1 });
    }
    const { machine, rows, hooks } = fake(row({ state: 'HUMAN_WAITING_Q' }));
    hooks.beforeApply = () => void rows.set(ID, row({ state: 'HUMAN_ACTIVE', assignedUserId: U1, version: 1 }));
    const raced = await err(machine.transition(TX, ID, claim, OPTS));
    expect(raced).toBeInstanceOf(ConversationAlreadyClaimedError);
    expect(raced).toMatchObject({ assignedUserId: U1 });
  });

  it('is already claimed (0 rows, Brief P14) even when what changed under it was not another claim', async () => {
    const { machine, rows, hooks } = fake(row({ state: 'HUMAN_WAITING_Q' }));
    hooks.beforeApply = () => void rows.set(ID, row({ state: 'CLOSED', closedAt: NOW, outcome: 'won', version: 1 }));
    expect(await err(machine.transition(TX, ID, claim, OPTS))).toMatchObject({ code: 'conversation_already_claimed', assignedUserId: null });
  });

  it('is an invalid transition, not a claim race, on a conversation the bot handles or that is closed', async () => {
    for (const r of [row(), row({ state: 'CLOSED', closedAt: NOW, outcome: 'won' })]) {
      await expect(fake(r).machine.transition(TX, ID, claim, OPTS)).rejects.toThrow(InvalidTransitionError);
    }
  });
});

// prettier-ignore
describe('the actions of a person need the version they saw', () => {
  const ACTIONS: [string, ConversationEvent, ConversationRow][] = [
    ['T09', say({ type: 'agent_waits_customer' }), held('HUMAN_ACTIVE')],
    ['T12', say({ type: 'hand_back_to_bot' }), held('HUMAN_ACTIVE')],
    ['T13', say({ type: 'close', now: NOW, outcome: 'won' }), held('PENDING_CUSTOMER')],
    ['T15', say({ type: 'transfer', toUserId: U2 }), held('HUMAN_ACTIVE')],
    ['T16', say({ type: 'reassign', toUserId: U2 }), held('PENDING_CUSTOMER')],
    ['T21', say({ type: 'reassign', toUserId: U2 }), row({ state: 'HUMAN_WAITING_Q', version: 3 })],
  ];

  it.each(ACTIONS)('%s: no version is a bug in the caller, a stale one a conflict, the current one goes through', async (_id, event, r) => {
    const { machine, calls } = fake(r);
    await expect(machine.transition(TX, ID, event, OPTS)).rejects.toThrow(MissingExpectedVersionError);
    await expect(machine.transition(TX, ID, event, { ...OPTS, expectedVersion: 2 })).rejects.toThrow(VersionConflictError);
    expect(calls.apply).toBe(0);
    expect(await machine.transition(TX, ID, event, { ...OPTS, expectedVersion: 3 })).toMatchObject({ kind: 'changed' });
  });

  it('never retries an action of a person: a miss is a version conflict', async () => {
    const { machine, hooks, calls } = fake(held('HUMAN_ACTIVE'));
    hooks.misses = 1;
    await expect(machine.transition(TX, ID, say({ type: 'agent_waits_customer' }), { ...OPTS, expectedVersion: 3 })).rejects.toThrow(VersionConflictError);
    expect(calls.apply).toBe(1);
  });

  it('is a version conflict when the row changes between the read and the write', async () => {
    const { machine, rows, hooks } = fake(held('HUMAN_ACTIVE'));
    hooks.beforeApply = () => void rows.set(ID, { ...held('HUMAN_ACTIVE'), version: 4 });
    await expect(machine.transition(TX, ID, say({ type: 'agent_waits_customer' }), { ...OPTS, expectedVersion: 3 })).rejects.toThrow(VersionConflictError);
  });
});

// prettier-ignore
describe('a system event that loses the race', () => {
  const online = say({ type: 'customer_message', now: NOW, agentOnline: true });

  it('reads again and decides again, then succeeds', async () => {
    const { machine, calls, hooks, events } = fake(held('PENDING_CUSTOMER'));
    hooks.misses = 1;
    expect(await machine.transition(TX, ID, online, OPTS)).toMatchObject({ kind: 'changed', transition: 'T10' });
    expect([calls.load, calls.apply, events.length]).toEqual([2, 2, 1]);
  });

  it('stops, without an error, when the second read makes it a no-op', async () => {
    const { machine, rows, hooks } = fake(held('PENDING_CUSTOMER'));
    hooks.beforeApply = () => void rows.set(ID, { ...held('HUMAN_ACTIVE'), version: 4 });
    expect(await machine.transition(TX, ID, online, OPTS)).toEqual({ kind: 'unchanged', reason: 'customer_message_keeps_state' });
  });

  it('gives up after three attempts with ConversationContendedError', async () => {
    const { machine, calls, hooks, events } = fake(held('PENDING_CUSTOMER'));
    hooks.misses = 99;
    await expect(machine.transition(TX, ID, online, OPTS)).rejects.toThrow(ConversationContendedError);
    expect([calls.load, calls.apply, events.length]).toEqual([3, 3, 0]);
  });
});
