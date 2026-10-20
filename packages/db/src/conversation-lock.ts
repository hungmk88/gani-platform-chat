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
export async function lockConversation(tx: TenantTx, conversationId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${conversationId}::text))`);
}
