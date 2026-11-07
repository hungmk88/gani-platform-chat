import {
  addWorkingSeconds,
  SLA_SECONDS,
  workingSecondsBetween,
  type WorkSchedule,
} from '../workspace/working-time.js';
import type { ConversationState } from './types.js';

// The SLA of a conversation after a transition (E3a; N208, and N210 with E3b; Q7 provisional values, CEO 07/11/2026). Pure: the state machine reads
// the SLA it had and the schedule of the workspace, calls this, and writes what it gives back in the same transaction. The clock runs
// in working time only (E2) while a person owes the customer an answer:
// - into HUMAN_WAITING_Q, from anywhere (a handover, an agent away, the customer back while the agent is offline): a new SLA from 0,
//   so the person who takes it never carries the time of the one before (Q-b, E3-1);
// - into HUMAN_ACTIVE: from BOT_ACTIVE (a claim of a held conversation) a new SLA; from PENDING_CUSTOMER (the customer answered) the
//   rest of the paused one, its old due time kept when nothing was left (Q-c); otherwise as it was (a claim from the queue, a transfer);
// - into PENDING_CUSTOMER: paused, waiting for the customer, with what was left (0 when already overdue);
// - into BOT_ACTIVE or CLOSED: none.
// The pause outside the hours (`outside_hours`) and its end are the job of E4, not of a transition.

export type SlaPauseReason = 'waiting_customer' | 'outside_hours';

export interface ConversationSla {
  readonly dueAt: Date;
  readonly pausedReason: SlaPauseReason | null;
  /** Working seconds left when it paused, ≥ 0; null while it runs. */
  readonly remainingSeconds: number | null;
}

const fresh = (s: WorkSchedule, at: Date): ConversationSla => ({
  dueAt: addWorkingSeconds(s, at, SLA_SECONDS),
  pausedReason: null,
  remainingSeconds: null,
});

/** The SLA a conversation has after moving from `from` to `to` at `at`, given the one it had. */
export function slaAfterTransition(
  had: ConversationSla | null,
  from: ConversationState | null,
  to: ConversationState,
  at: Date,
  s: WorkSchedule,
): ConversationSla | null {
  if (to === 'BOT_ACTIVE' || to === 'CLOSED') return null;
  if (to === 'HUMAN_WAITING_Q') return from === 'HUMAN_WAITING_Q' && had ? had : fresh(s, at);
  if (to === 'PENDING_CUSTOMER') {
    if (had?.pausedReason) return had;
    const running = had ?? fresh(s, at);
    const left = Math.max(0, workingSecondsBetween(s, at, running.dueAt));
    return { dueAt: running.dueAt, pausedReason: 'waiting_customer', remainingSeconds: left };
  }
  // HUMAN_ACTIVE
  if (from === 'BOT_ACTIVE' || from === null || !had) return fresh(s, at);
  if (from === 'PENDING_CUSTOMER' && had.pausedReason) {
    const left = had.remainingSeconds ?? 0;
    const dueAt = left > 0 ? addWorkingSeconds(s, at, left) : had.dueAt;
    return { dueAt, pausedReason: null, remainingSeconds: null };
  }
  return had;
}

/** Whether two SLAs are the same, so an unchanged one is not written again. */
export const sameSla = (a: ConversationSla | null, b: ConversationSla | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.dueAt.getTime() === b.dueAt.getTime() &&
    a.pausedReason === b.pausedReason &&
    a.remainingSeconds === b.remainingSeconds);
