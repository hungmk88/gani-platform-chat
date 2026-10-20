// The vocabulary of the conversation state machine (FSM spec, Brief P14). Pure data: no I/O, no clock, no database.

export const CONVERSATION_STATES = [
  'BOT_ACTIVE',
  'HUMAN_WAITING_Q',
  'HUMAN_ACTIVE',
  'PENDING_CUSTOMER',
  'CLOSED',
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

// Brief v1.0 P14 (N130): a person closes with resolved, no_response or spam; the bot with resolved_by_bot (T04). Won and lost belong
// to the lead, not to the conversation.
export const CONVERSATION_OUTCOMES = [
  'resolved',
  'no_response',
  'spam',
  'resolved_by_bot',
] as const;
export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number];

/** What the state machine owns of a conversation: the columns the guard trigger protects (N96). */
export interface ConversationSnapshot {
  readonly state: ConversationState;
  readonly afterHoursHold: boolean;
  readonly assignedUserId: string | null;
  readonly closedAt: Date | null;
  readonly outcome: ConversationOutcome | null;
}

/**
 * What happened. Facts that depend on a clock, a schedule or a presence service (`inHours`, `slaExceeded`, `agentOnline`,
 * `offlineLongEnough`) are decided by the caller and passed in, so the table below never reads them from anywhere.
 */
export type ConversationEvent =
  | { readonly type: 'conversation_started' }
  | { readonly type: 'customer_message'; readonly now: Date; readonly agentOnline: boolean }
  | { readonly type: 'needs_human'; readonly inHours: boolean }
  | { readonly type: 'bot_resolved'; readonly now: Date }
  | { readonly type: 'claim'; readonly userId: string }
  | { readonly type: 'wait_expired'; readonly inHours: boolean; readonly slaExceeded: boolean }
  | { readonly type: 'release_after_hours'; readonly inHours: boolean }
  | { readonly type: 'agent_waits_customer' }
  | { readonly type: 'hand_back_to_bot' }
  | {
      readonly type: 'close';
      readonly now: Date;
      readonly outcome: Exclude<ConversationOutcome, 'resolved_by_bot'>;
    }
  | { readonly type: 'transfer'; readonly toUserId: string }
  | { readonly type: 'reassign'; readonly toUserId: string }
  | {
      readonly type: 'agent_offline_timeout';
      readonly inHours: boolean;
      readonly offlineLongEnough: boolean;
      readonly customerUnanswered: boolean;
    }
  | { readonly type: 'agent_logout'; readonly inHours: boolean };
export type ConversationEventType = ConversationEvent['type'];

/** T01..T21 of the FSM spec §2 (T21 is F2: a Manager assigns a conversation that waits in the queue). */
// prettier-ignore
export type TransitionId =
  | 'T01' | 'T02' | 'T03' | 'T04' | 'T05' | 'T06' | 'T07' | 'T08' | 'T09' | 'T10' | 'T11'
  | 'T12' | 'T13' | 'T14' | 'T15' | 'T16' | 'T17' | 'T18' | 'T19' | 'T20' | 'T21';

/** The `event_type` of the `conversation_events` row a transition writes. */
export type HistoryType =
  'created' | 'state_changed' | 'claimed' | 'transferred' | 'reassigned' | 'reopened';

/** Outbox event types a transition asks for (outbox spec §3). `conversation.manager_alert` is not in that catalog yet. */
export type ConversationEffect =
  | 'conversation.created'
  | 'conversation.state_changed'
  | 'conversation.assigned'
  | 'agent.transferred'
  | 'agent.reassigned'
  | 'conversation.handoff_requested'
  | 'conversation.manager_alert';

export type NoChangeReason =
  'customer_message_keeps_state' | 'agent_away_while_pending' | 'reopen_window_passed';

export type DecideResult =
  | {
      readonly kind: 'transition';
      readonly transition: TransitionId;
      readonly next: ConversationSnapshot;
      readonly history: HistoryType;
      readonly effects: readonly ConversationEffect[];
    }
  | { readonly kind: 'no_change'; readonly reason: NoChangeReason };
