import { and, eq, sql } from 'drizzle-orm';

import { conversations } from './schema/conversations.js';
import { messages } from './schema/messages.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';

// Writing a message (realtime spec §4, N107). Every function takes the caller's TenantTx and never commits, so the message, the state
// change it causes and the outbox row are one transaction. The organisation comes from the tenant context (CLAUDE.md rule 1).
// This file never logs, and no error it raises carries the body of a message.
//
// LOCK ORDER (N107): a path that writes a message and also changes the conversation takes the advisory lock of the conversation FIRST,
// before any UPDATE of its `conversations` row. `insertMessage` takes it, then updates the row; the state machine updates the row
// after. A path that changed the row first and appended afterwards could wait on a writer that already holds the lock and wants the row:
// a deadlock (40P01).

export type MessageSenderKind = 'customer' | 'agent' | 'bot' | 'system';
export type MessageKind = 'text' | 'image' | 'file' | 'sticker' | 'postback' | 'system';

export interface NewMessage {
  readonly id: string;
  readonly conversationId: string;
  /** The workspace of the conversation the caller read: the foreign key and the policy both check that it is the right one. */
  readonly workspaceId: string;
  readonly senderKind: MessageSenderKind;
  /** The person who sent it (an agent); none for a customer, the bot and the system. */
  readonly senderUserId?: string | null;
  readonly kind: MessageKind;
  /** What was said. It is PII: never logged, never in an error. Null for an image, a file, a sticker. */
  readonly body?: string | null;
  /** The id the platform gave the message. */
  readonly platformMessageId?: string | null;
  /** When the platform says it was sent. Display order is `(platform_sent_at, platform_message_id)`, not `sequence_number`. */
  readonly platformSentAt?: Date | null;
}

export interface StoredMessage {
  readonly id: string;
  readonly sequenceNumber: number;
}

/**
 * Adds a message to a conversation and gives it the next `sequence_number`.
 *
 * The advisory lock lasts until COMMIT, so the messages of one conversation queue up and the order of the numbers is the order of the
 * commits: a reader never sees 6 before 5 is committed. The number is `MAX + 1`, read after the lock (READ COMMITTED sees the previous
 * writer's row); it cannot be UNIQUE, as `messages` is partitioned by month. Two conversations never wait for each other (a clash of the
 * 32-bit hash only waits too long). A message that arrives late gets a higher number and is shown in its place by `platform_sent_at`;
 * numbers are never reassigned (R2).
 *
 * It also moves the marks of the conversation: `last_message_at`, and for a customer `last_customer_message_at`, the start of the free
 * window (the platform's send time, or now). Both only go forward (`GREATEST`): `now()` is the time the transaction began, and a
 * writer that began early but got the lock late must not write an older time over a newer one; a late message does not pull the
 * window back.
 */
export async function insertMessage(tx: TenantTx, message: NewMessage): Promise<StoredMessage> {
  const { orgId } = currentTenantContext();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${message.conversationId}::text))`);
  const [next] = await tx
    .select({ value: sql<string>`coalesce(max(${messages.sequenceNumber}), 0) + 1` })
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.conversationId, message.conversationId)));
  const [stored] = await tx
    .insert(messages)
    .values({
      id: message.id,
      orgId,
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      sequenceNumber: Number(next?.value),
      senderKind: message.senderKind,
      senderUserId: message.senderUserId ?? null,
      kind: message.kind,
      body: message.body ?? null,
      platformMessageId: message.platformMessageId ?? null,
      platformSentAt: message.platformSentAt ?? null,
    })
    .returning({ id: messages.id, sequenceNumber: messages.sequenceNumber });
  if (!stored) throw new Error('message insert returned no row');

  const c = conversations;
  const never = sql`'-infinity'::timestamptz`;
  const sentAt = sql`coalesce(${message.platformSentAt?.toISOString() ?? null}::timestamptz, now())`;
  const marked = await tx
    .update(c)
    .set({
      lastMessageAt: sql`greatest(coalesce(${c.lastMessageAt}, ${never}), now())`,
      updatedAt: sql`now()`,
      ...(message.senderKind === 'customer'
        ? {
            lastCustomerMessageAt: sql`greatest(coalesce(${c.lastCustomerMessageAt}, ${never}), ${sentAt})`,
          }
        : {}),
    })
    .where(eq(c.id, message.conversationId))
    .returning({ id: c.id });
  // The insert above is refused by the policy for a conversation the tenant cannot see; this is the net under it.
  if (marked.length === 0) throw new Error('conversation not visible: the message was not kept');
  return stored;
}
