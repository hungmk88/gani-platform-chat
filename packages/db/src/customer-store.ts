import { and, eq } from 'drizzle-orm';

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
