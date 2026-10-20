import { describe, expect, it } from 'vitest';

import { createDecide, decide } from './decide.js';
import { InvalidSnapshotError, InvalidTransitionError } from './errors.js';
import { REOPEN_WINDOW_MS, snapshotViolations } from './snapshot.js';
import { TRANSITIONS, type Row } from './transitions.js';
import type {
  ConversationEffect,
  ConversationEvent,
  ConversationSnapshot,
  ConversationState,
  HistoryType,
  NoChangeReason,
  TransitionId,
} from './types.js';

// The oracle is written by hand from the FSM spec §2 and does not read TRANSITIONS: a row added, dropped or changed in the table
// without the spec table (and this list) changing makes the sweep fail.
const [U1, U2] = ['user-1', 'user-2'];
const CLOSED_AT = new Date('2026-10-01T00:00:00Z');
const hours = (h: number): Date => new Date(CLOSED_AT.getTime() + h * 3_600_000);
const [WITHIN, BEYOND] = [hours(71), hours(73)];

const snap = (
  state: ConversationState,
  over: Partial<ConversationSnapshot> = {},
): ConversationSnapshot => ({
  state,
  afterHoursHold: false,
  assignedUserId: null,
  closedAt: null,
  outcome: null,
  ...over,
});
const held = (state: 'HUMAN_ACTIVE' | 'PENDING_CUSTOMER', user = U1) =>
  snap(state, { assignedUserId: user });
const [QUEUE_S, HOLD_S] = [snap('HUMAN_WAITING_Q'), snap('BOT_ACTIVE', { afterHoursHold: true })];
const closedS = (outcome: 'resolved' | 'no_response' | 'spam' | 'resolved_by_bot') =>
  snap('CLOSED', { closedAt: WITHIN, outcome });

// prettier-ignore
const SNAPSHOTS: Record<string, ConversationSnapshot | null> = {
  new: null, bot: snap('BOT_ACTIVE'), botHold: HOLD_S, waiting: QUEUE_S, active: held('HUMAN_ACTIVE'), pending: held('PENDING_CUSTOMER'),
  closed: snap('CLOSED', { closedAt: CLOSED_AT, outcome: 'resolved' }),
};
const msg = (agentOnline: boolean, now: Date): ConversationEvent => ({
  type: 'customer_message',
  now,
  agentOnline,
});
// prettier-ignore
const EVENTS: Record<string, ConversationEvent> = {
  started: { type: 'conversation_started' },
  msgOnWithin: msg(true, WITHIN), msgOffWithin: msg(false, WITHIN), msgOnBeyond: msg(true, BEYOND), msgOffBeyond: msg(false, BEYOND),
  needsIn: { type: 'needs_human', inHours: true }, needsOut: { type: 'needs_human', inHours: false },
  resolved: { type: 'bot_resolved', now: WITHIN }, claim: { type: 'claim', userId: U2 },
  releaseIn: { type: 'release_after_hours', inHours: true }, releaseOut: { type: 'release_after_hours', inHours: false },
  waits: { type: 'agent_waits_customer' }, back: { type: 'hand_back_to_bot' },
  closeNoResponse: { type: 'close', now: WITHIN, outcome: 'no_response' }, closeSpam: { type: 'close', now: WITHIN, outcome: 'spam' },
  closeResolved: { type: 'close', now: WITHIN, outcome: 'resolved' },
  transfer: { type: 'transfer', toUserId: U2 }, reassign: { type: 'reassign', toUserId: U2 },
  logoutIn: { type: 'agent_logout', inHours: true }, logoutOut: { type: 'agent_logout', inHours: false },
};
for (const inHours of [true, false]) {
  const h = inHours ? 'In' : 'Out';
  for (const slaExceeded of [true, false])
    EVENTS[`expired${h}${slaExceeded ? 'Sla' : 'Ok'}`] = {
      type: 'wait_expired',
      inHours,
      slaExceeded,
    };
  for (const offlineLongEnough of [true, false])
    for (const customerUnanswered of [true, false]) {
      const name = `offline${h}${offlineLongEnough ? 'Long' : 'Short'}${customerUnanswered ? 'Unanswered' : 'Answered'}`;
      EVENTS[name] = {
        type: 'agent_offline_timeout',
        inHours,
        offlineLongEnough,
        customerUnanswered,
      };
    }
}

interface Expect {
  id: TransitionId;
  next: ConversationSnapshot;
  history: HistoryType;
  effects: ConversationEffect[];
}
const to = (
  id: TransitionId,
  next: ConversationSnapshot,
  history: HistoryType,
  effects: ConversationEffect[],
): Expect => ({ id, next, history, effects });
const CHANGED: ConversationEffect[] = ['conversation.state_changed'];
const QUEUE: ConversationEffect[] = [...CHANGED, 'conversation.handoff_requested'];
const CLAIMED: ConversationEffect[] = [...CHANGED, 'conversation.assigned'];
const STAYS: NoChangeReason = 'customer_message_keeps_state';
const AWAY: NoChangeReason = 'agent_away_while_pending';
const closedBy = (o: 'resolved' | 'no_response' | 'spam') =>
  to('T13', closedS(o), 'state_changed', CHANGED);
const MSGS = ['msgOnWithin', 'msgOffWithin', 'msgOnBeyond', 'msgOffBeyond'];

// [snapshot, event names, what the table must answer]. Every pair listed nowhere must throw InvalidTransitionError.
// prettier-ignore
const ORACLE: [string, string[], Expect | NoChangeReason][] = [
  ['new', ['started'], to('T01', snap('BOT_ACTIVE'), 'created', ['conversation.created'])],
  ['bot', ['needsIn'], to('T02', QUEUE_S, 'state_changed', QUEUE)],
  ['bot', ['needsOut'], to('T03', HOLD_S, 'state_changed', CHANGED)],
  ['bot', ['resolved'], to('T04', closedS('resolved_by_bot'), 'state_changed', CHANGED)],
  ['botHold', ['resolved'], to('T04', closedS('resolved_by_bot'), 'state_changed', CHANGED)],
  ['waiting', ['claim'], to('T05', held('HUMAN_ACTIVE', U2), 'claimed', CLAIMED)],
  ['botHold', ['claim'], to('T06', held('HUMAN_ACTIVE', U2), 'claimed', CLAIMED)],
  ['waiting', ['expiredOutOk', 'expiredOutSla', 'expiredInSla'], to('T07', HOLD_S, 'state_changed', CHANGED)],
  ['botHold', ['releaseIn'], to('T08', QUEUE_S, 'state_changed', QUEUE)],
  ['active', ['waits'], to('T09', held('PENDING_CUSTOMER'), 'state_changed', CHANGED)],
  ['pending', ['msgOnWithin', 'msgOnBeyond'], to('T10', held('HUMAN_ACTIVE'), 'state_changed', CHANGED)],
  ['pending', ['msgOffWithin', 'msgOffBeyond'], to('T11', QUEUE_S, 'state_changed', CHANGED)],
  ['active', ['back'], to('T12', snap('BOT_ACTIVE'), 'state_changed', CHANGED)],
  ['active', ['closeNoResponse'], closedBy('no_response')], ['pending', ['closeNoResponse'], closedBy('no_response')],
  ['active', ['closeSpam'], closedBy('spam')], ['pending', ['closeSpam'], closedBy('spam')],
  ['active', ['closeResolved'], closedBy('resolved')], ['pending', ['closeResolved'], closedBy('resolved')],
  ['closed', ['msgOnWithin', 'msgOffWithin'], to('T14', snap('BOT_ACTIVE'), 'reopened', CHANGED)],
  ['active', ['transfer'], to('T15', held('HUMAN_ACTIVE', U2), 'transferred', ['agent.transferred'])],
  ['pending', ['transfer'], to('T15', held('PENDING_CUSTOMER', U2), 'transferred', ['agent.transferred'])],
  ['active', ['reassign'], to('T16', held('HUMAN_ACTIVE', U2), 'reassigned', ['agent.reassigned'])],
  ['pending', ['reassign'], to('T16', held('PENDING_CUSTOMER', U2), 'reassigned', ['agent.reassigned'])],
  ['waiting', ['reassign'], to('T21', held('HUMAN_ACTIVE', U2), 'reassigned', [...CHANGED, 'agent.reassigned'])],
  ['active', ['offlineInLongUnanswered'], to('T17', QUEUE_S, 'state_changed', [...CHANGED, 'conversation.manager_alert'])],
  ['active', ['offlineOutLongUnanswered'], to('T18', HOLD_S, 'state_changed', CHANGED)],
  ['active', ['logoutIn'], to('T19', QUEUE_S, 'state_changed', CHANGED)],
  ['active', ['logoutOut'], to('T20', HOLD_S, 'state_changed', CHANGED)],
  ['bot', MSGS, STAYS], ['botHold', MSGS, STAYS], ['waiting', MSGS, STAYS], ['active', MSGS, STAYS],
  ['closed', ['msgOnBeyond', 'msgOffBeyond'], 'reopen_window_passed'],
  ['pending', Object.keys(EVENTS).filter((n) => n.startsWith('offline') || n.startsWith('logout')), AWAY],
];

const key = (s: string, e: string) => `${s}/${e}`;
const expected = new Map<string, Expect | NoChangeReason>();
for (const [s, events, want] of ORACLE)
  for (const e of events) {
    if (expected.has(key(s, e))) throw new Error(`oracle lists ${key(s, e)} twice`);
    expected.set(key(s, e), want);
  }
const answer = (want: Expect | NoChangeReason | undefined): string =>
  JSON.stringify(
    want === undefined
      ? 'invalid'
      : typeof want === 'string'
        ? { kind: 'no_change', reason: want }
        : {
            kind: 'transition',
            transition: want.id,
            next: want.next,
            history: want.history,
            effects: want.effects,
          },
  );

/** Every (snapshot, event) pair against the oracle; returns the pairs that disagree. `decideFn` is the code under test. */
function sweep(decideFn: ReturnType<typeof createDecide>): string[] {
  const wrong: string[] = [];
  for (const [s, current] of Object.entries(SNAPSHOTS)) {
    for (const [e, event] of Object.entries(EVENTS)) {
      let got: string;
      try {
        got = JSON.stringify(decideFn(current, event));
      } catch (error) {
        got = error instanceof InvalidTransitionError ? '"invalid"' : `threw ${String(error)}`;
      }
      if (got !== answer(expected.get(key(s, e)))) wrong.push(key(s, e));
    }
  }
  return wrong;
}

describe('decide against the oracle of the spec', () => {
  it('answers exactly what the spec table says for every state, flag and event, and refuses the rest', () => {
    expect(sweep(decide)).toEqual([]);
  });

  it('lists every transition of the table at least once', () => {
    const covered = new Set(
      [...expected.values()].flatMap((w) => (typeof w === 'string' ? [] : [w.id])),
    );
    const ids = TRANSITIONS.flatMap((r) => ('reason' in r ? [] : [r.id]));
    expect([...covered].sort()).toEqual([...ids].sort());
    expect(ids).toHaveLength(21);
  });

  it('only ever produces a snapshot the database accepts (the CHECKs of the spec §3)', () => {
    for (const current of Object.values(SNAPSHOTS)) {
      for (const event of Object.values(EVENTS)) {
        try {
          const result = decide(current, event);
          if (result.kind === 'transition') expect(snapshotViolations(result.next)).toEqual([]);
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidTransitionError);
        }
      }
    }
  });
});

describe('mutation: a broken table must fail the sweep', () => {
  const tweak = (i: number, change: (row: Row) => Row): Row[] =>
    TRANSITIONS.map((row, k) => (k === i ? change(row) : row));
  const rows = TRANSITIONS.map((row, i) => [row.id, i] as const);
  const guarded = rows.filter(([, i]) => TRANSITIONS[i]?.guard);
  type Guard = (e: ConversationEvent, c: ConversationSnapshot | null) => boolean;
  type Apply = (
    e: ConversationEvent,
    c: ConversationSnapshot | null,
  ) => Partial<ConversationSnapshot>;

  it.each(rows)('dropping row %s is caught', (_id, i) => {
    expect(sweep(createDecide(TRANSITIONS.filter((_, k) => k !== i))).length).toBeGreaterThan(0);
  });

  it.each(rows)('changing what row %s writes is caught', (_id, i) => {
    const mutate = (row: Row): Row =>
      'reason' in row
        ? { ...row, reason: row.reason === STAYS ? AWAY : STAYS }
        : {
            ...row,
            apply: (e: ConversationEvent, c: ConversationSnapshot | null) => ({
              ...(row.apply as Apply)(e, c),
              closedAt: new Date(0),
            }),
          };
    expect(sweep(createDecide(tweak(i, mutate))).length).toBeGreaterThan(0);
  });

  it.each(guarded)('negating the guard of row %s is caught', (_id, i) => {
    const mutate = (row: Row): Row => {
      const guard = row.guard as Guard;
      return { ...row, guard: ((e, c) => !guard(e, c)) as Guard };
    };
    expect(sweep(createDecide(tweak(i, mutate))).length).toBeGreaterThan(0);
  });
});

describe('the edges the sweep does not name', () => {
  const closed = SNAPSHOTS['closed'] as ConversationSnapshot;
  const event = (name: string) => EVENTS[name] as ConversationEvent;
  const at = (ms: number): ConversationEvent => msg(true, new Date(CLOSED_AT.getTime() + ms));

  it('reopens at exactly 72 hours and not a millisecond later (F5)', () => {
    expect(decide(closed, at(REOPEN_WINDOW_MS))).toMatchObject({
      kind: 'transition',
      transition: 'T14',
    });
    expect(decide(closed, at(REOPEN_WINDOW_MS + 1))).toEqual({
      kind: 'no_change',
      reason: 'reopen_window_passed',
    });
  });

  it('says guard_failed when a row exists but its condition is not met, not_in_table otherwise', () => {
    const guardFailed = () => decide(QUEUE_S, event('expiredInOk'));
    expect(guardFailed).toThrowError(
      expect.objectContaining({
        code: 'invalid_transition',
        reason: 'guard_failed',
        from: 'HUMAN_WAITING_Q',
      }),
    );
    expect(() => decide(snap('BOT_ACTIVE'), event('claim'))).toThrowError(
      expect.objectContaining({ reason: 'not_in_table' }),
    );
  });

  it('refuses a snapshot that breaks the invariants', () => {
    expect(() =>
      decide(snap('HUMAN_ACTIVE', { afterHoursHold: true }), event('waits')),
    ).toThrowError(InvalidSnapshotError);
  });

  it('refuses a table whose row produces a snapshot the database would reject', () => {
    const bad: Row = {
      id: 'T09',
      event: 'agent_waits_customer',
      from: ['HUMAN_ACTIVE'],
      history: 'state_changed',
      effects: [],
      apply: () => ({ assignedUserId: null }),
    };
    expect(() => createDecide([bad])(held('HUMAN_ACTIVE'), event('waits'))).toThrowError(
      InvalidSnapshotError,
    );
  });
});
