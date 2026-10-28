import { and, eq, isNull, sql } from 'drizzle-orm';

import { conversations } from './schema/conversations.js';
import { customerIdentities, customers } from './schema/customers.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The customers of an organisation (CRM J1/J2, Brief §360 M03, N165). Row-level security keeps them to the transaction's organisation:
// a customer belongs to the company, not to one workspace. Nothing here reads or logs a name, a phone or an email.

/**
 * The customer that the Zalo user `externalUserId` of `channelAccountId` is, made (with no name yet) the first time that person writes.
 * Zalo gives a user id per OA (Brief §543), so the channel account is part of the identity. Take `lockContact` of the same pair first:
 * two first messages of one person then make one customer, not two.
 */
export async function customerForContact(
  tx: TenantTx,
  q: {
    readonly channelAccountId: string;
    readonly externalUserId: string;
    readonly newId: () => string;
  },
): Promise<string> {
  const channelAccountId = assertUuid(q.channelAccountId, 'channelAccountId');
  const i = customerIdentities;
  const [found] = await tx
    .select({ customerId: i.customerId })
    .from(i)
    .where(
      and(
        eq(i.identityType, 'zalo_uid'),
        eq(i.channelAccountId, channelAccountId),
        eq(i.externalId, q.externalUserId),
      ),
    );
  if (found) return found.customerId;
  const { orgId } = currentTenantContext();
  const customerId = assertUuid(q.newId(), 'newId');
  await tx.insert(customers).values({ id: customerId, orgId });
  await tx.insert(i).values({
    id: assertUuid(q.newId(), 'newId'),
    orgId,
    customerId,
    identityType: 'zalo_uid',
    channelAccountId,
    externalId: q.externalUserId,
  });
  return customerId;
}

/**
 * Names `customerId` as the customer of a conversation that has none yet: a new one, or one older than customers (N165). A conversation
 * that has a customer keeps it (the merge of J3 will move them). True when the row changed.
 */
export async function linkConversationCustomer(
  tx: TenantTx,
  conversationId: string,
  customerId: string,
): Promise<boolean> {
  const c = conversations;
  const rows = await tx
    .update(c)
    .set({ customerId: assertUuid(customerId, 'customerId') })
    .where(and(eq(c.id, assertUuid(conversationId, 'conversationId')), isNull(c.customerId)))
    .returning({ id: c.id });
  return rows.length === 1;
}

/** What may change of a customer; null clears a field. Values are already checked (E.164, lower-case email) by the caller. */
export interface CustomerChange {
  readonly displayName?: string | null;
  readonly phoneE164?: string | null;
  readonly email?: string | null;
  readonly humanOnly?: boolean;
}

/**
 * Applies `change` to a live customer of the organisation; false when there is none (deleted, unknown, another org's). The name is stored
 * in NFC (customers_display_name_nfc_check), so a search compares it as stored.
 */
export async function updateCustomer(
  tx: TenantTx,
  id: string,
  change: CustomerChange,
): Promise<boolean> {
  const rows = await tx
    .update(customers)
    .set({
      ...change,
      ...(change.displayName ? { displayName: change.displayName.normalize('NFC') } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(customers.id, assertUuid(id, 'id')), isNull(customers.deletedAt)))
    .returning({ id: customers.id });
  return rows.length === 1;
}
