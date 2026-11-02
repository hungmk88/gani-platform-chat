import { and, eq, isNull, sql } from 'drizzle-orm';
import type pg from 'pg';

import { channelAccounts } from './schema/channel-accounts.js';
import { conversations } from './schema/conversations.js';
import { messageDeliveries } from './schema/message-deliveries.js';
import { messages } from './schema/messages.js';
import type { TenantTx } from './tenant-tx.js';

// The deliveries the outbound worker sends to the channel (O2, N185, zalo-channel-spec §5): which organisations have work, the claim
// of one delivery under a lease, and the one UPDATE that writes its result. Every function but the first takes the caller's TenantTx
// (organisation and workspace: message_deliveries is filtered by both) and never commits. Calling the platform is the worker's, outside
// any transaction. The claim carries the text of the message and the account's ciphertexts: PII and secrets, never logged.

const d = messageDeliveries;
/** A code, never a message of the platform: the CHECK of message_deliveries.last_error (F-03, N124). */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function assertWhole(name: string, value: number, min: number, max = 86_400 * 7): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number between ${min} and ${max}`);
  }
}

/**
 * The organisations with deliveries to send, the oldest work first, asked outside any tenant through `app.outbound_pending_orgs`
 * (SECURITY DEFINER, ids only; it checks its own bounds).
 */
export async function outboundPendingOrgs(
  pool: pg.Pool,
  limit: number,
  leaseSeconds: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.outbound_pending_orgs($1, $2)',
    [limit, leaseSeconds],
  );
  return rows.map((r) => r.org_id);
}

/** A delivery the worker holds, with what the channel needs to send it. */
export interface OutboundClaim {
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly channelAccountId: string;
  /** Counts this claim: 1 the first time. */
  readonly attempts: number;
  /** Names this claim: the write of its result must match the same value. */
  readonly claimedAt: Date;
  /** The message: `body` is PII. Never logged, never put in an error. */
  readonly message: {
    readonly kind: string;
    readonly body: string | null;
    readonly sequenceNumber: number;
  };
  /** The person on the channel (the platform's id of them); null when the conversation has no channel any more. */
  readonly externalUserId: string | null;
  /** The account, with its access token as ciphertext of SecretBox under `keyVersion`; null when it was deleted. */
  readonly account: {
    readonly type: string;
    readonly status: string;
    readonly externalAccountId: string;
    readonly accessTokenEnc: Buffer | null;
    readonly keyVersion: number;
  } | null;
}

/**
 * Claims the next delivery of the tenant's workspace and stamps `claimed_at`, or null when none is due. Due: pending, not claimed and
 * past its next attempt, or claimed longer ago than the lease (a worker died holding it): the test of app.outbound_pending_orgs, change
 * both together. Only the pending delivery of a conversation whose message comes first is ever claimed, so the messages of a conversation
 * reach the person in order (A 02/11/2026): a later one waits while an earlier one is in flight or waiting for its next attempt. The
 * order is the message's sequence_number, given under the conversation's lock: not created_at (the start of a transaction, which may
 * take the lock after a later one) nor the id (UUIDv7 is ordered within one process only, and the worker may run several). `FOR UPDATE SKIP LOCKED`
 * hands two workers disjoint deliveries. The stamp is cut to milliseconds, so the Date returned is the stored value exactly.
 */
export async function claimOutboundDelivery(
  tx: TenantTx,
  leaseSeconds: number,
): Promise<OutboundClaim | null> {
  assertWhole('leaseSeconds', leaseSeconds, 1);
  const { rows } = await tx.execute<{ id: string }>(sql`
    SELECT ${d.id} AS id FROM ${d}
    WHERE ${d.status} = 'pending'
      AND ((${d.claimedAt} IS NULL AND ${d.nextAttemptAt} <= now())
        OR ${d.claimedAt} < now() - make_interval(secs => ${leaseSeconds}))
      AND NOT EXISTS (
        SELECT 1 FROM ${d} e
        JOIN messages me ON me.org_id = e.org_id AND me.conversation_id = e.conversation_id AND me.id = e.message_id
        WHERE e.org_id = ${d.orgId} AND e.conversation_id = ${d.conversationId} AND e.status = 'pending'
          AND me.sequence_number < (
            SELECT mine.sequence_number FROM messages mine
            WHERE mine.org_id = ${d.orgId} AND mine.conversation_id = ${d.conversationId} AND mine.id = ${d.messageId}))
    ORDER BY ${d.nextAttemptAt}, ${d.id}
    LIMIT 1
    FOR UPDATE OF message_deliveries SKIP LOCKED`);
  const id = rows[0]?.id;
  if (id === undefined) return null;
  const [held] = await tx
    .update(d)
    .set({
      claimedAt: sql`date_trunc('milliseconds', now())`,
      attempts: sql`${d.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(d.id, id))
    .returning();
  const delivery = held!;
  const [message] = await tx
    .select({ kind: messages.kind, body: messages.body, sequenceNumber: messages.sequenceNumber })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, delivery.conversationId),
        eq(messages.id, delivery.messageId),
      ),
    );
  const [conversation] = await tx
    .select({ externalUserId: conversations.externalUserId })
    .from(conversations)
    .where(eq(conversations.id, delivery.conversationId));
  const [account] = await tx
    .select({
      type: channelAccounts.type,
      status: channelAccounts.status,
      externalAccountId: channelAccounts.externalAccountId,
      accessTokenEnc: channelAccounts.accessTokenEnc,
      keyVersion: channelAccounts.keyVersion,
    })
    .from(channelAccounts)
    .where(
      and(eq(channelAccounts.id, delivery.channelAccountId), isNull(channelAccounts.deletedAt)),
    );
  // A delivery always names a stored message of its conversation (the send writes both in one transaction).
  if (!message) throw new Error('the message of a delivery is missing');
  return {
    id: delivery.id,
    workspaceId: delivery.workspaceId,
    conversationId: delivery.conversationId,
    messageId: delivery.messageId,
    channelAccountId: delivery.channelAccountId,
    attempts: delivery.attempts,
    claimedAt: delivery.claimedAt!,
    message,
    externalUserId: conversation?.externalUserId ?? null,
    account: account ?? null,
  };
}

/** The claim whose result is written: the delivery and the `claimedAt` its claim returned. */
export interface OutboundKey {
  readonly id: string;
  readonly claimedAt: Date;
}

/** Still this claim of a pending delivery: a worker whose lease was taken back writes nothing. */
const holds = (key: OutboundKey) =>
  and(eq(d.id, key.id), eq(d.claimedAt, key.claimedAt), eq(d.status, 'pending'));

const checkCode = (code: string) => {
  // The error does not repeat the value: it may be the very text this check is there to keep out.
  if (!ERROR_CODE.test(code))
    throw new TypeError('error code must match ^[A-Z][A-Z0-9_]{0,63}$ (a code, never a message)');
};

/** The platform took the message: `sent`, with its id. False when the claim is not this worker's any more. */
export async function completeOutboundDelivery(
  tx: TenantTx,
  key: OutboundKey,
  platformMessageId: string,
): Promise<boolean> {
  if (platformMessageId.trim() === '') throw new TypeError('platformMessageId must not be empty');
  const rows = await tx
    .update(d)
    .set({
      status: 'sent',
      platformMessageId,
      sentAt: sql`now()`,
      claimedAt: null,
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(holds(key))
    .returning({ id: d.id });
  return rows.length === 1;
}

/** A failure worth another attempt: claim released, next attempt in `delaySeconds`, the code kept. False when not this claim any more. */
export async function retryOutboundDelivery(
  tx: TenantTx,
  key: OutboundKey,
  failure: { readonly errorCode: string; readonly delaySeconds: number },
): Promise<boolean> {
  checkCode(failure.errorCode);
  assertWhole('delaySeconds', failure.delaySeconds, 0);
  const rows = await tx
    .update(d)
    .set({
      claimedAt: null,
      nextAttemptAt: sql`now() + make_interval(secs => ${failure.delaySeconds})`,
      lastError: failure.errorCode,
      updatedAt: sql`now()`,
    })
    .where(holds(key))
    .returning({ id: d.id });
  return rows.length === 1;
}

/** The last attempt failed, or the failure is final (the window closed, the account is gone): `failed` for good. */
export async function failOutboundDelivery(
  tx: TenantTx,
  key: OutboundKey,
  errorCode: string,
): Promise<boolean> {
  checkCode(errorCode);
  const rows = await tx
    .update(d)
    .set({ status: 'failed', claimedAt: null, lastError: errorCode, updatedAt: sql`now()` })
    .where(holds(key))
    .returning({ id: d.id });
  return rows.length === 1;
}
