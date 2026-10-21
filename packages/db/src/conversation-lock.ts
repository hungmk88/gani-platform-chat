import { sql } from 'drizzle-orm';

import type { TenantTx } from './tenant-tx.js';

/**
 * The lock of one conversation (N107, review AR-05): a transaction advisory lock on the conversation's id, held until COMMIT or
 * ROLLBACK. Every write that changes a conversation takes it FIRST, before any UPDATE of its `conversations` row: `insertMessage`
 * (the messages and the marks) and `applyTransition` (the state machine). So two transactions on one conversation always queue on this
 * lock, never on the row in one order and on the lock in the other (a deadlock, 40P01). Taking it again in the same transaction does
 * not wait. Two conversations whose ids hash alike (32 bits) only wait for each other, they never deadlock. The pool's lock_timeout
 * (5 s) bounds the wait.
 */
/** The first key of the two-key locks of persons (any constant other than the conversations' one-key space works). */
const CONTACT_LOCK_SPACE = 7201;

/**
 * The lock of one person of one channel account (inbound spec §3 step 3): the inbound processor takes it BEFORE it looks for that
 * person's conversation, so two messages of one person never create two conversations (the unique index conversations_open_per_user_key
 * would refuse the second with 23505). Order: this lock, then the conversation's. The two-key form keeps it apart from the one-key
 * locks of conversations: the same 32-bit hash can never make a conversation and a person wait for each other.
 */
export async function lockContact(
  tx: TenantTx,
  channelAccountId: string,
  externalUserId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${CONTACT_LOCK_SPACE}, hashtext(${channelAccountId}::text || ':' || ${externalUserId}::text))`,
  );
}
export async function lockConversation(tx: TenantTx, conversationId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${conversationId}::text))`);
}
