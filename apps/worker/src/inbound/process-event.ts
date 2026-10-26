import { normalizeZalo } from '@gani/channels';
import type { ConversationStateMachine, MessageService } from '@gani/conversations';
import {
  customerForContact,
  findConversationForContact,
  linkConversationCustomer,
  lockContact,
  markInboundIgnored,
  markInboundProcessed,
  type ClaimedInboundEvent,
  type TenantTx,
} from '@gani/db';
import { REOPEN_WINDOW_MS, uuidv7 } from '@gani/domain';

// One inbound event in one transaction (inbound spec §3): normalise → lock the person → find or make their customer (N165) → find,
// reopen or create the conversation and name its customer → store the message and let the state machine react → mark the event
// processed. The caller opens the transaction in the tenant of the event, its workspace included (conversations and messages are
// filtered by workspace). Nothing here logs the payload.

/** The claim of the event was lost (the lease expired and another worker took it): everything of this transaction must roll back. */
export class InboundLeaseLostError extends Error {
  readonly code = 'E_LEASE_LOST';
  constructor() {
    super('the claim of the inbound event was lost');
    this.name = 'InboundLeaseLostError';
  }
}

export interface InboundServices {
  readonly fsm: ConversationStateMachine;
  readonly messages: MessageService;
}

export async function processInboundEvent(
  tx: TenantTx,
  event: ClaimedInboundEvent,
  services: InboundServices,
  now: Date = new Date(),
): Promise<'processed' | 'ignored'> {
  const key = { id: event.id, receivedAt: event.receivedAt };
  const payload: Record<string, unknown> =
    typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const sentAt = payload['timestamp'];
  const normalized = normalizeZalo(
    {
      eventName: event.eventType,
      timestamp: /^[0-9]{10,16}$/.test(String(sentAt))
        ? String(sentAt)
        : String(event.receivedAt.getTime()),
      raw: payload,
    },
    Buffer.alloc(0), // the key of the event is already known: event.platformMessageId
  );
  if (normalized.kind === 'ignored') {
    if (!(await markInboundIgnored(tx, key, normalized.reason))) throw new InboundLeaseLostError();
    return 'ignored';
  }
  const { externalUserId } = normalized;
  // The person's lock before the conversation's (conversation-lock.ts): two messages of one person never make two conversations.
  await lockContact(tx, event.channelAccountId, externalUserId);
  const customerId = await customerForContact(tx, {
    channelAccountId: event.channelAccountId,
    externalUserId,
    newId: uuidv7,
  });
  const found = await findConversationForContact(tx, event.channelAccountId, externalUserId);
  const expired =
    found?.state === 'CLOSED' &&
    found.closedAt !== null &&
    now.getTime() - found.closedAt.getTime() > REOPEN_WINDOW_MS;
  let conversationId = found && !expired ? found.id : null;
  if (conversationId === null) {
    const created = await services.fsm.create(tx, {
      workspaceId: event.workspaceId,
      actor: { kind: 'customer' },
      traceId: event.id,
      channel: { channelAccountId: event.channelAccountId, externalUserId },
    });
    if (created.kind !== 'changed') throw new Error('creating a conversation must change it');
    conversationId = created.conversation.id;
  }
  // A new conversation, or one older than customers (N165): it gets its customer now; one that has a customer keeps it.
  await linkConversationCustomer(tx, conversationId, customerId);
  // A closed conversation within 72 hours is reopened here (T14); agentOnline is false until presence exists (N107(3), S4).
  await services.messages.receiveCustomerMessage(tx, {
    conversationId,
    kind: normalized.messageKind,
    body: normalized.body,
    platformMessageId: event.platformMessageId,
    platformSentAt: normalized.platformSentAt,
    traceId: event.id,
    agentOnline: false,
    now,
  });
  if (!(await markInboundProcessed(tx, key))) throw new InboundLeaseLostError();
  return 'processed';
}
