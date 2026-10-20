import { and, eq, sql } from 'drizzle-orm';

import { lockConversation } from './conversation-lock.js';
import { conversationEvents } from './schema/conversation-events.js';
import { conversations } from './schema/conversations.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';

// The only code that writes the columns of `conversations` the ConversationStateMachine owns (CLAUDE.md rule 4, FSM spec §5).
// Every function takes the caller's TenantTx and never commits, so a transition, its event and (later) its outbox rows are one
// transaction. States are plain strings here: the CHECKs of the table are the last guard.

export interface ConversationRow {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly state: string;
  readonly version: number;
  readonly assignedUserId: string | null;
  readonly afterHoursHold: boolean;
  readonly closedAt: Date | null;
  readonly outcome: string | null;
}

/** The columns the state machine owns, as a transition leaves them. */
export interface ConversationFsmColumns {
  readonly state: string;
  readonly afterHoursHold: boolean;
  readonly assignedUserId: string | null;
  readonly closedAt: Date | null;
  readonly outcome: string | null;
}

export interface NewConversation extends ConversationFsmColumns {
  readonly id: string;
  readonly workspaceId: string;
  /** The channel account and the person of that channel (inbound spec §3, I2). Written here only: app_role cannot UPDATE them. */
  readonly channel?:
    { readonly channelAccountId: string; readonly externalUserId: string } | undefined;
}

export interface TransitionWrite {
  readonly id: string;
  /** What the caller read and decided from: the UPDATE only matches while the row still looks like this. */
  readonly from: { readonly state: string; readonly afterHoursHold: boolean };
  /** The version the client saw. Absent for a claim and for system events (FSM spec §6). */
  readonly expectedVersion?: number;
  readonly next: ConversationFsmColumns;
}

export interface NewConversationEvent {
  readonly id: string;
  readonly conversationId: string;
  readonly eventType: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly fromHold: boolean | null;
  readonly toHold: boolean | null;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly versionAfter: number;
  readonly outcome: string | null;
  readonly traceId: string;
  /** No PII and no message text (FSM spec §7). */
  readonly detail: Record<string, unknown>;
}

const columns = {
  id: conversations.id,
  orgId: conversations.orgId,
  workspaceId: conversations.workspaceId,
  state: conversations.state,
  version: conversations.version,
  assignedUserId: conversations.assignedUserId,
  afterHoursHold: conversations.afterHoursHold,
  closedAt: conversations.closedAt,
  outcome: conversations.outcome,
};

/** The conversation, or `null` when it does not exist or the tenant context cannot see it (RLS: another org or workspace). */
export async function loadConversation(tx: TenantTx, id: string): Promise<ConversationRow | null> {
  const [row] = await tx.select(columns).from(conversations).where(eq(conversations.id, id));
  return row ?? null;
}

/** Inserts a conversation in the organisation of the tenant context (never a parameter: CLAUDE.md rule 1). Version starts at 0. */
export async function insertConversation(
  tx: TenantTx,
  input: NewConversation,
): Promise<ConversationRow> {
  const { channel, ...fields } = input;
  const [row] = await tx
    .insert(conversations)
    .values({ ...fields, ...channel, orgId: currentTenantContext().orgId })
    .returning(columns);
  if (!row) throw new Error('conversation insert returned no row');
  return row;
}

/**
 * One conditional UPDATE: it changes the row only while it is still in `from.state` with the same flag (and, when given, at
 * `expectedVersion`), and raises `version` by one. Returns the new row, or `null` for 0 rows: somebody else got there first, or
 * the row is not visible. Under READ COMMITTED (the default, do not raise it) a loser waits for the winner's lock and re-tests
 * the condition, so exactly one of many concurrent claims matches. No Redlock.
 *
 * It takes the conversation's lock first (lockConversation, review AR-05), as `insertMessage` does, so the two never wait for each
 * other in opposite orders. `app.fsm` is on only around this statement (guard trigger 202610061110). No try/finally on purpose: a failed statement aborts
 * the transaction, the setting dies with the rollback, and a further statement would only hide the real error.
 */
export async function applyTransition(
  tx: TenantTx,
  write: TransitionWrite,
): Promise<ConversationRow | null> {
  // The conversation's lock before its row (review AR-05): see conversation-lock.ts.
  await lockConversation(tx, write.id);
  await tx.execute(sql`SELECT set_config('app.fsm', 'on', true)`);
  const [row] = await tx
    .update(conversations)
    .set({
      ...write.next,
      version: sql`${conversations.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversations.id, write.id),
        eq(conversations.state, write.from.state),
        eq(conversations.afterHoursHold, write.from.afterHoursHold),
        write.expectedVersion === undefined
          ? undefined
          : eq(conversations.version, write.expectedVersion),
      ),
    )
    .returning(columns);
  await tx.execute(sql`SELECT set_config('app.fsm', 'off', true)`);
  return row ?? null;
}

/** Appends one row of the history of a conversation, in the organisation of the tenant context. */
export async function insertConversationEvent(
  tx: TenantTx,
  event: NewConversationEvent,
): Promise<void> {
  await tx.insert(conversationEvents).values({ ...event, orgId: currentTenantContext().orgId });
}
