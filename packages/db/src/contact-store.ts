import { and, desc, eq, sql } from 'drizzle-orm';
import type pg from 'pg';

import type { ConversationRow } from './conversation-store.js';
import { conversations } from './schema/conversations.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// What the inbound processor reads to place a customer's message (inbound spec §3): the channel account a webhook names, and the
// conversation of a person of that account. The SQL of the lookup lives here; the decision (use it, reopen it, start a new one) is
// the processor's.

/**
 * The conversation of `externalUserId` on `channelAccountId` that a new message of that person belongs to, or the most recently closed
 * one when none is open (the processor reopens it within 72 hours, T14, or starts a new one). `null` for a person never seen. Take
 * `lockContact` first. At most one is open (conversations_open_per_user_key), so "open first, then the latest closed" is one row.
 */
export async function findConversationForContact(
  tx: TenantTx,
  channelAccountId: string,
  externalUserId: string,
): Promise<ConversationRow | null> {
  const c = conversations;
  const [row] = await tx
    .select({
      id: c.id,
      orgId: c.orgId,
      workspaceId: c.workspaceId,
      state: c.state,
      version: c.version,
      assignedUserId: c.assignedUserId,
      afterHoursHold: c.afterHoursHold,
      closedAt: c.closedAt,
      outcome: c.outcome,
    })
    .from(c)
    .where(
      and(
        eq(c.channelAccountId, assertUuid(channelAccountId, 'channelAccountId')),
        eq(c.externalUserId, externalUserId),
      ),
    )
    .orderBy(sql`${c.state} = 'CLOSED'`, desc(c.closedAt), desc(c.id))
    .limit(1);
  return row ?? null;
}

export interface WebhookChannelAccount {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly status: string;
  readonly keyVersion: number;
  readonly appId: string | null;
  /** Ciphertext (nonce, tag, data); the API decrypts it with the key of `keyVersion` and never logs it. */
  readonly appSecretEnc: Buffer | null;
  readonly oaSecretKeyEnc: Buffer | null;
}

/**
 * The channel account a webhook names, before any tenant is known (`app.channel_account_for_webhook`, SECURITY DEFINER, N105). `null`
 * for an unknown or deleted account. A `disconnected` one is returned with its status: the caller answers it like an unknown one.
 * On the pool of app_role; the id comes from the URL, so it is checked as a UUID before any query.
 */
export async function channelAccountForWebhook(
  pool: pg.Pool,
  channelAccountId: string,
): Promise<WebhookChannelAccount | null> {
  const { rows } = await pool.query<{
    org_id: string;
    workspace_id: string;
    type: string;
    status: string;
    key_version: number;
    app_id: string | null;
    app_secret_enc: Buffer | null;
    oa_secret_key_enc: Buffer | null;
  }>('SELECT * FROM app.channel_account_for_webhook($1)', [
    assertUuid(channelAccountId, 'channelAccountId'),
  ]);
  const r = rows[0];
  if (!r) return null;
  return {
    orgId: r.org_id,
    workspaceId: r.workspace_id,
    type: r.type,
    status: r.status,
    keyVersion: r.key_version,
    appId: r.app_id,
    appSecretEnc: r.app_secret_enc,
    oaSecretKeyEnc: r.oa_secret_key_enc,
  };
}
