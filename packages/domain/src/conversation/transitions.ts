import { REOPEN_WINDOW_MS } from './snapshot.js';
import type {
  ConversationEffect,
  ConversationEvent,
  ConversationEventType,
  ConversationSnapshot,
  ConversationState,
  HistoryType,
  NoChangeReason,
  TransitionId,
} from './types.js';

type EventOf<T extends ConversationEventType> = Extract<ConversationEvent, { type: T }>;

interface RowBase<T extends ConversationEventType> {
  readonly event: T;
  /** States the row applies to; `null` is "no conversation yet". */
  readonly from: readonly (ConversationState | null)[];
  /** The after-hours flag the row requires; absent = either. */
  readonly hold?: boolean;
  /** A condition on the facts the caller passed. A row whose guard fails is skipped. */
  readonly guard?: (event: EventOf<T>, current: ConversationSnapshot | null) => boolean;
}
export interface TransitionRow<
  T extends ConversationEventType = ConversationEventType,
> extends RowBase<T> {
  readonly id: TransitionId;
  readonly history: HistoryType;
  readonly effects: readonly ConversationEffect[];
  /** Only what changes; the rest of the snapshot is kept. */
  readonly apply: (
    event: EventOf<T>,
    current: ConversationSnapshot | null,
  ) => Partial<ConversationSnapshot>;
}
export interface NoChangeRow<
  T extends ConversationEventType = ConversationEventType,
> extends RowBase<T> {
  readonly id: string;
  readonly reason: NoChangeReason;
}
export type Row = {
  [T in ConversationEventType]: TransitionRow<T> | NoChangeRow<T>;
}[ConversationEventType];

const HUMAN: readonly ConversationState[] = ['HUMAN_ACTIVE', 'PENDING_CUSTOMER'];
const STATE_CHANGED: readonly ConversationEffect[] = ['conversation.state_changed'];
const TO_QUEUE: readonly ConversationEffect[] = [
  'conversation.state_changed',
  'conversation.handoff_requested',
];
const CLAIMED: readonly ConversationEffect[] = [
  'conversation.state_changed',
  'conversation.assigned',
];

const withinReopenWindow = (
  e: EventOf<'customer_message'>,
  c: ConversationSnapshot | null,
): boolean => c?.closedAt != null && e.now.getTime() - c.closedAt.getTime() <= REOPEN_WINDOW_MS;
// An agent who has been away long enough while a customer waits for an answer (T17, T18).
const abandoned = (e: EventOf<'agent_offline_timeout'>): boolean =>
  e.offlineLongEnough && e.customerUnanswered;

/**
 * The transition table of FSM spec §2 (Brief P14 and its v0.4 additions), in the order they are tried. A state, flag and event
 * with no row here is an error (`InvalidTransitionError`): that is the whole rule "transition không có trong bảng → lỗi".
 */
// One row per line keeps the table readable as a table and diffable against the spec, so Prettier leaves it alone.
// prettier-ignore
export const TRANSITIONS: readonly Row[] = [
  { id: 'T01', event: 'conversation_started', from: [null], history: 'created', effects: ['conversation.created'], apply: () => ({}) },
  { id: 'T02', event: 'needs_human', from: ['BOT_ACTIVE'], hold: false, guard: (e) => e.inHours, history: 'state_changed', effects: TO_QUEUE, apply: () => ({ state: 'HUMAN_WAITING_Q' }) },
  { id: 'T03', event: 'needs_human', from: ['BOT_ACTIVE'], hold: false, guard: (e) => !e.inHours, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ afterHoursHold: true }) },
  { id: 'T04', event: 'bot_resolved', from: ['BOT_ACTIVE'], history: 'state_changed', effects: STATE_CHANGED, apply: (e) => ({ state: 'CLOSED', afterHoursHold: false, closedAt: e.now, outcome: 'resolved_by_bot' }) },
  { id: 'T05', event: 'claim', from: ['HUMAN_WAITING_Q'], history: 'claimed', effects: CLAIMED, apply: (e) => ({ state: 'HUMAN_ACTIVE', assignedUserId: e.userId }) },
  { id: 'T06', event: 'claim', from: ['BOT_ACTIVE'], hold: true, history: 'claimed', effects: CLAIMED, apply: (e) => ({ state: 'HUMAN_ACTIVE', afterHoursHold: false, assignedUserId: e.userId }) },
  { id: 'T07', event: 'wait_expired', from: ['HUMAN_WAITING_Q'], guard: (e) => !e.inHours || e.slaExceeded, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'BOT_ACTIVE', afterHoursHold: true }) },
  { id: 'T08', event: 'release_after_hours', from: ['BOT_ACTIVE'], hold: true, guard: (e) => e.inHours, history: 'state_changed', effects: TO_QUEUE, apply: () => ({ state: 'HUMAN_WAITING_Q', afterHoursHold: false }) },
  { id: 'T09', event: 'agent_waits_customer', from: ['HUMAN_ACTIVE'], history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'PENDING_CUSTOMER' }) },
  { id: 'T10', event: 'customer_message', from: ['PENDING_CUSTOMER'], guard: (e) => e.agentOnline, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'HUMAN_ACTIVE' }) },
  { id: 'T11', event: 'customer_message', from: ['PENDING_CUSTOMER'], guard: (e) => !e.agentOnline, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'HUMAN_WAITING_Q', assignedUserId: null }) },
  { id: 'T12', event: 'hand_back_to_bot', from: ['HUMAN_ACTIVE'], history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'BOT_ACTIVE', assignedUserId: null }) },
  { id: 'T13', event: 'close', from: HUMAN, history: 'state_changed', effects: STATE_CHANGED, apply: (e) => ({ state: 'CLOSED', assignedUserId: null, closedAt: e.now, outcome: e.outcome }) },
  { id: 'T14', event: 'customer_message', from: ['CLOSED'], guard: withinReopenWindow, history: 'reopened', effects: STATE_CHANGED, apply: () => ({ state: 'BOT_ACTIVE', closedAt: null, outcome: null }) },
  { id: 'T15', event: 'transfer', from: HUMAN, history: 'transferred', effects: ['agent.transferred'], apply: (e) => ({ assignedUserId: e.toUserId }) },
  { id: 'T16', event: 'reassign', from: HUMAN, history: 'reassigned', effects: ['agent.reassigned'], apply: (e) => ({ assignedUserId: e.toUserId }) },
  { id: 'T21', event: 'reassign', from: ['HUMAN_WAITING_Q'], history: 'reassigned', effects: ['conversation.state_changed', 'agent.reassigned'], apply: (e) => ({ state: 'HUMAN_ACTIVE', assignedUserId: e.toUserId }) },
  { id: 'T17', event: 'agent_offline_timeout', from: ['HUMAN_ACTIVE'], guard: (e) => abandoned(e) && e.inHours, history: 'state_changed', effects: ['conversation.state_changed', 'conversation.manager_alert'], apply: () => ({ state: 'HUMAN_WAITING_Q', assignedUserId: null }) },
  { id: 'T18', event: 'agent_offline_timeout', from: ['HUMAN_ACTIVE'], guard: (e) => abandoned(e) && !e.inHours, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'BOT_ACTIVE', afterHoursHold: true, assignedUserId: null }) },
  { id: 'T19', event: 'agent_logout', from: ['HUMAN_ACTIVE'], guard: (e) => e.inHours, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'HUMAN_WAITING_Q', assignedUserId: null }) },
  { id: 'T20', event: 'agent_logout', from: ['HUMAN_ACTIVE'], guard: (e) => !e.inHours, history: 'state_changed', effects: STATE_CHANGED, apply: () => ({ state: 'BOT_ACTIVE', afterHoursHold: true, assignedUserId: null }) },
  // Events that are not transitions (spec §2): the message is stored by the message flow, the state stays.
  { id: 'N1', event: 'customer_message', from: ['BOT_ACTIVE', 'HUMAN_WAITING_Q', 'HUMAN_ACTIVE'], reason: 'customer_message_keeps_state' },
  { id: 'N2', event: 'customer_message', from: ['CLOSED'], guard: (e, c) => !withinReopenWindow(e, c), reason: 'reopen_window_passed' },
  { id: 'N3', event: 'agent_offline_timeout', from: ['PENDING_CUSTOMER'], reason: 'agent_away_while_pending' },
  { id: 'N4', event: 'agent_logout', from: ['PENDING_CUSTOMER'], reason: 'agent_away_while_pending' },
];
