import { messageDeliveries } from './schema/message-deliveries.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

export type DeliveryStatus = (typeof messageDeliveries.$inferSelect)['status'];

export interface NewPendingDelivery {
  /** UUIDv7 made by the caller (rule 2), like every id this package writes. */
  readonly id: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly channelAccountId: string;
}

/**
 * The delivery of a message of the account, `pending`, written in the transaction of the send so that a message to the channel never
 * exists without it (N146). The organisation is the one of the transaction (RLS checks it); the outbound worker (8b) moves the row on.
 */
export async function insertPendingDelivery(tx: TenantTx, d: NewPendingDelivery): Promise<void> {
  await tx.insert(messageDeliveries).values({
    id: assertUuid(d.id, 'id'),
    orgId: currentTenantContext().orgId,
    workspaceId: assertUuid(d.workspaceId, 'workspaceId'),
    conversationId: assertUuid(d.conversationId, 'conversationId'),
    messageId: assertUuid(d.messageId, 'messageId'),
    channelAccountId: assertUuid(d.channelAccountId, 'channelAccountId'),
  });
}
