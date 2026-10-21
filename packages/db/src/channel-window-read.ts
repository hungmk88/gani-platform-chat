import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';

import { channelAccounts } from './schema/channel-accounts.js';
import { channelPolicies } from './schema/channel-policies.js';
import { conversations } from './schema/conversations.js';
import { messages } from './schema/messages.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// What `ChannelPolicyService.check` reads before a send (channel-policy-spec §2–4), in the transaction of the send, after the lock of
// the conversation. The policy table is global (no RLS, read only); the facts of the conversation are read under RLS.

export interface ChannelPolicyRow {
  readonly id: string;
  readonly freeWindowSeconds: number | null;
  readonly freeMessageQuota: number | null;
  readonly outsideWindowAllowed: boolean;
  readonly note: string;
}

/** The policy in force at `at` for a channel and a class of message: the row with the latest `effective_from ≤ at` (§4, C-N6). */
export async function readChannelPolicy(
  tx: TenantTx,
  channelType: string,
  messageClass: string,
  at: Date,
): Promise<ChannelPolicyRow | null> {
  const p = channelPolicies;
  const [row] = await tx
    .select({
      id: p.id,
      freeWindowSeconds: p.freeWindowSeconds,
      freeMessageQuota: p.freeMessageQuota,
      outsideWindowAllowed: p.outsideWindowAllowed,
      note: p.note,
    })
    .from(p)
    .where(
      and(
        eq(p.channelType, channelType),
        eq(p.messageClass, messageClass),
        lte(p.effectiveFrom, at),
      ),
    )
    .orderBy(desc(p.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export interface WindowFactsRow {
  /** `channel_accounts.type` of the conversation; null when it has no channel, or the channel was deleted. */
  readonly channelType: string | null;
  readonly lastCustomerMessageAt: Date | null;
  /** Messages of the account (agent, bot, system) after the last message of the person, by sequence number (C5). */
  readonly officialMessagesSinceCustomer: number;
}

/** The facts of `windowState` for a conversation visible to the transaction, or null when it is not found. */
export async function loadWindowFacts(
  tx: TenantTx,
  conversationId: string,
): Promise<WindowFactsRow | null> {
  assertUuid(conversationId, 'conversationId');
  const c = conversations;
  const m = messages;
  // The last message of the person by sequence number; with none, every message of the conversation counts (outside the window anyway).
  const lastCustomer = sql`coalesce((SELECT max(${m.sequenceNumber}) FROM ${m} WHERE ${m.orgId} = ${c.orgId}
    AND ${m.conversationId} = ${c.id} AND ${m.senderKind} = 'customer'), 0)`;
  const [row] = await tx
    .select({
      channelType: channelAccounts.type,
      lastCustomerMessageAt: c.lastCustomerMessageAt,
      officialMessagesSinceCustomer: sql<number>`(SELECT count(*)::int FROM ${m} WHERE ${m.orgId} = ${c.orgId}
        AND ${m.conversationId} = ${c.id} AND ${m.senderKind} <> 'customer' AND ${m.sequenceNumber} > ${lastCustomer})`,
    })
    .from(c)
    .leftJoin(
      channelAccounts,
      and(
        eq(channelAccounts.orgId, c.orgId),
        eq(channelAccounts.id, c.channelAccountId),
        isNull(channelAccounts.deletedAt),
      ),
    )
    .where(eq(c.id, conversationId));
  return row ?? null;
}
