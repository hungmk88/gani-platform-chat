import { InvalidSnapshotError, InvalidTransitionError } from './errors.js';
import { INITIAL_SNAPSHOT, snapshotViolations } from './snapshot.js';
import { TRANSITIONS, type Row } from './transitions.js';
import type { ConversationEvent, ConversationSnapshot, DecideResult } from './types.js';

type Decide = (current: ConversationSnapshot | null, event: ConversationEvent) => DecideResult;

/**
 * Builds `decide` over a table. The table is a parameter so a test can hand it a broken copy and see its own checks fail
 * (mutation); production code uses `decide` below.
 */
export function createDecide(table: readonly Row[]): Decide {
  return (current, event) => {
    if (current) {
      const violations = snapshotViolations(current);
      if (violations.length > 0) throw new InvalidSnapshotError(violations);
    }
    const state = current?.state ?? null;
    let sawRow = false;
    for (const row of table) {
      if (row.event !== event.type || !row.from.includes(state)) continue;
      if (row.hold !== undefined && row.hold !== (current?.afterHoursHold ?? false)) continue;
      sawRow = true;
      // `row.event === event.type` was checked above, so the row's own guard and apply receive the event type they declare.
      const guard = row.guard as
        ((e: ConversationEvent, c: ConversationSnapshot | null) => boolean) | undefined;
      if (guard && !guard(event, current)) continue;
      if ('reason' in row) return { kind: 'no_change', reason: row.reason };
      const apply = row.apply as (
        e: ConversationEvent,
        c: ConversationSnapshot | null,
      ) => Partial<ConversationSnapshot>;
      const next: ConversationSnapshot = {
        ...(current ?? INITIAL_SNAPSHOT),
        ...apply(event, current),
      };
      const broken = snapshotViolations(next);
      if (broken.length > 0) throw new InvalidSnapshotError(broken);
      return {
        kind: 'transition',
        transition: row.id,
        next,
        history: row.history,
        effects: row.effects,
      };
    }
    throw new InvalidTransitionError(state, event.type, sawRow ? 'guard_failed' : 'not_in_table');
  };
}

/**
 * What the event does to the conversation, or why it is refused. Pure: the same snapshot and event always give the same answer.
 * `current` is `null` only for `conversation_started`. Throws `InvalidTransitionError` for an event the table does not allow.
 */
export const decide: Decide = createDecide(TRANSITIONS);
