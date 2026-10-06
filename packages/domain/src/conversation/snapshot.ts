import type { ConversationSnapshot } from './types.js';

/** The reopen window of Brief P14: a customer who writes within 72 hours of the close reopens the same conversation (F5). */
export const REOPEN_WINDOW_MS = 72 * 60 * 60 * 1000;

export const INITIAL_SNAPSHOT: ConversationSnapshot = {
  state: 'BOT_ACTIVE',
  afterHoursHold: false,
  assignedUserId: null,
  closedAt: null,
  outcome: null,
};

/** Same rules as the CHECKs of 202610061100 (spec §3), so a state the table produces is one the database accepts. Empty = valid. */
export function snapshotViolations(s: ConversationSnapshot): string[] {
  const found: string[] = [];
  const held = s.state === 'HUMAN_ACTIVE' || s.state === 'PENDING_CUSTOMER';
  if (s.afterHoursHold && s.state !== 'BOT_ACTIVE') found.push('a hold exists only in BOT_ACTIVE');
  if (held !== (s.assignedUserId !== null))
    found.push('a person is assigned exactly when a person holds it');
  if ((s.state === 'CLOSED') !== (s.closedAt !== null)) found.push('closed_at exactly when CLOSED');
  if ((s.state === 'CLOSED') !== (s.outcome !== null)) found.push('outcome exactly when CLOSED');
  return found;
}
