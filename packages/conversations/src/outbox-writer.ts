import { insertOutboxEvent, type NewOutboxEvent, type TenantTx } from '@gani/db';
import { uuidv7, type ConversationEffect, type TransitionId } from '@gani/domain';

/** The one function of the outbox store the writer needs; a test passes a fake. */
export interface OutboxStore {
  insertOutboxEvent: typeof insertOutboxEvent;
}

// A payload names things, it does not hold them (outbox spec §3): ids, states, flags. A key that smells of content or of a person is a bug.
const NOT_REFERENCES = /text|body|content|name|email|phone|address/i;

/**
 * Writes business events into `outbox_events` on the caller's transaction, so they live or die with the data that caused them. Never
 * calls the queue: the relay does that later (worker/CLAUDE.md).
 */
export class OutboxWriter {
  constructor(private readonly store: OutboxStore) {}

  async add(tx: TenantTx, event: NewOutboxEvent): Promise<void> {
    for (const [key, value] of Object.entries(event.payload)) {
      if (NOT_REFERENCES.test(key))
        throw new Error(`outbox payload key "${key}" looks like content, not a reference`);
      if (value !== null && typeof value === 'object')
        throw new Error(`outbox payload key "${key}" is not a plain value`);
    }
    await this.store.insertOutboxEvent(tx, event);
  }
}

/** What a conversation event is, once decided: enough to build every outbox row of its effects. */
export interface ConversationFact {
  readonly conversationId: string;
  readonly workspaceId: string;
  /** The version of the conversation after the change (0 for a new one). */
  readonly version: number;
  readonly transition: TransitionId;
  readonly from: {
    readonly state: string;
    readonly afterHoursHold: boolean;
    readonly assignedUserId: string | null;
  } | null;
  readonly to: {
    readonly state: string;
    readonly afterHoursHold: boolean;
    readonly assignedUserId: string | null;
  };
  readonly actor: { readonly kind: string; readonly id?: string };
  readonly traceId: string;
}

// Why a manager is alerted: T17 is the only transition that asks for it.
const ALERT_REASONS: Partial<Record<TransitionId, string>> = { T17: 'agent_offline' };

function payloadOf(
  effect: ConversationEffect,
  f: ConversationFact,
): Record<string, string | boolean | null> {
  const conversationId = f.conversationId;
  switch (effect) {
    case 'conversation.created':
    case 'conversation.handoff_requested':
      return { conversationId };
    case 'conversation.state_changed':
      return {
        conversationId,
        from: f.from?.state ?? null,
        to: f.to.state,
        hold: f.to.afterHoursHold,
      };
    case 'conversation.assigned':
      return { conversationId, assignedUserId: f.to.assignedUserId };
    case 'agent.transferred':
    case 'agent.reassigned':
      return {
        conversationId,
        fromUserId: f.from?.assignedUserId ?? null,
        toUserId: f.to.assignedUserId,
      };
    case 'conversation.manager_alert': {
      const reason = ALERT_REASONS[f.transition];
      if (!reason) throw new Error(`transition ${f.transition} has no reason for a manager alert`);
      return { conversationId, reason };
    }
  }
}

/** The outbox row of one effect of a conversation transition (outbox spec §3). */
export function conversationOutboxEvent(
  effect: ConversationEffect,
  f: ConversationFact,
): NewOutboxEvent {
  return {
    id: uuidv7(),
    workspaceId: f.workspaceId,
    eventType: effect,
    aggregateType: 'conversation',
    aggregateId: f.conversationId,
    aggregateVersion: f.version,
    payload: payloadOf(effect, f),
    actorKind: f.actor.kind,
    actorId: f.actor.id ?? null,
    traceId: f.traceId,
  };
}

/** What a stored message is, once stored: enough to build its outbox row. It names the message, it does not hold it. */
export interface MessageFact {
  readonly conversationId: string;
  readonly workspaceId: string;
  readonly messageId: string;
  readonly sequenceNumber: number;
  readonly senderKind: 'customer' | 'agent' | 'bot' | 'system';
  readonly senderUserId?: string | null;
  readonly traceId: string;
}

/**
 * The outbox row of a new message (outbox spec §3): references only, never the text. `aggregateVersion` is null on purpose: a message
 * does not change the `version` of its conversation (that belongs to the state machine), and its order is its `sequenceNumber`; the
 * rule "drop a packet older than the aggregate version already held" is for the conversation events only (N107).
 */
export function messageCreatedOutboxEvent(f: MessageFact): NewOutboxEvent {
  return {
    id: uuidv7(),
    workspaceId: f.workspaceId,
    eventType: 'message.created',
    aggregateType: 'conversation',
    aggregateId: f.conversationId,
    aggregateVersion: null,
    payload: {
      conversationId: f.conversationId,
      messageId: f.messageId,
      sequenceNumber: f.sequenceNumber,
    },
    actorKind: f.senderKind,
    actorId: f.senderUserId ?? null,
    traceId: f.traceId,
  };
}
