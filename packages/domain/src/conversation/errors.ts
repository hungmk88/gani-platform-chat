import type { ConversationEventType, ConversationState } from './types.js';

/**
 * The event is not allowed in this state (P14: "transition không có trong bảng → lỗi"). `not_in_table`: no row for this state, flag
 * and event; `guard_failed`: there is a row, but its condition is not met by the facts the caller gave. The message names no user.
 */
export class InvalidTransitionError extends Error {
  readonly code = 'invalid_transition';
  constructor(
    readonly from: ConversationState | null,
    readonly event: ConversationEventType,
    readonly reason: 'not_in_table' | 'guard_failed',
  ) {
    super(`event ${event} is not allowed from ${from ?? 'no conversation'} (${reason})`);
    this.name = 'InvalidTransitionError';
  }
}

/** A snapshot that breaks the invariants of the data (the CHECKs of 202610061100): a bug upstream, never an answer for a user. */
export class InvalidSnapshotError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(`conversation snapshot breaks its invariants: ${violations.join('; ')}`);
    this.name = 'InvalidSnapshotError';
  }
}
