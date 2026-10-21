import { loadConversationView, loadMessageView, type TenantContext, type TenantTx } from '@gani/db';

import type { Logger } from '../logger.js';
import type { EventJobData } from '../relay/job.js';
import type { AgentEmitter } from './agent-emitter.js';
import { PermanentEventError, type EventHandler, type EventHandlers } from './event-consumer.js';
import { loggingHandlers } from './handlers.js';

// The routing of realtime spec §3: an outbox event becomes packets for the rooms of /agent. The outbox carries ids only (OutboxWriter
// refuses a body), so what a room shows is read here, under the tenant of the event, when it is sent. The names of the rooms are the
// ones of apps/api/src/modules/realtime/rooms.ts (the worker does not import the API): change both together.

export interface RealtimeDeps {
  readonly emitter: Pick<AgentEmitter, 'emit'>;
  /** A transaction in the tenant of the event (`withTenant` over the worker's pool). */
  readonly read: <T>(tenant: TenantContext, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
  readonly log: Logger;
}

const conv = (id: string) => `conv:${id}`;
const ws = (id: string) => `ws:${id}`;
const user = (id: string) => `user:${id}`;

/** Spec §3: what every packet carries, so the client can drop an old or repeated one (aggregateVersion, eventId). */
const envelope = (event: EventJobData, type: string, data: Record<string, unknown>) => ({
  eventId: event.id,
  type,
  version: event.version,
  occurredAt: event.occurredAt,
  traceId: event.traceId,
  aggregateVersion: event.aggregate.version,
  data,
});

const fields = (event: EventJobData): Record<string, unknown> =>
  typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {};
/** A field the payload must have: one missing is a bug of whoever wrote the event, not something a retry fixes. */
const id = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') throw new PermanentEventError('E_BAD_PAYLOAD');
  return value;
};
const maybe = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * The handlers of the consumer once realtime exists (they replace the logging ones, V8b). Every one is idempotent by event.id: sending
 * a packet twice is harmless, the client keeps the newest by aggregateVersion or sequenceNumber (N141). `event_consumed` is still
 * logged with the ids, after the packets are out.
 */
export function realtimeHandlers(deps: RealtimeDeps): EventHandlers {
  const { emitter, read, log } = deps;
  const done = (event: EventJobData) =>
    log.info('event_consumed', {
      eventId: event.id,
      type: event.type,
      orgId: event.orgId,
      workspaceId: event.workspaceId,
    });

  const messageCreated: EventHandler = async (event, tenant) => {
    const p = fields(event);
    const [conversationId, messageId] = [id(p['conversationId']), id(p['messageId'])];
    const message = await read(tenant, (tx) => loadMessageView(tx, messageId));
    if (!message) return log.warn('event_message_missing', { eventId: event.id, messageId });
    const full = {
      conversationId,
      messageId: message.id,
      sequenceNumber: message.sequenceNumber,
      senderKind: message.senderKind,
      senderUserId: message.senderUserId,
      kind: message.kind,
      body: message.body,
      platformSentAt: message.platformSentAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
    await emitter.emit(
      [conv(conversationId)],
      'message.created',
      envelope(event, 'message.created', full),
    );
    // The room of the workspace lists conversations: it gets the summary, never the content (R3).
    if (event.workspaceId) {
      const summary = {
        conversationId,
        sequenceNumber: full.sequenceNumber,
        senderKind: full.senderKind,
        createdAt: full.createdAt,
      };
      await emitter.emit(
        [ws(event.workspaceId)],
        'message.created',
        envelope(event, 'message.created', summary),
      );
    }
    done(event);
  };

  const stateChanged: EventHandler = async (event, tenant) => {
    const p = fields(event);
    const conversationId = id(p['conversationId']);
    const view = await read(tenant, (tx) => loadConversationView(tx, conversationId));
    const data = {
      conversationId,
      from: maybe(p['from']),
      to: maybe(p['to']),
      hold: p['hold'] === true,
      version: event.aggregate.version,
      assignedUserId: view?.assignedUserId ?? null,
    };
    const rooms = [conv(conversationId), ...(event.workspaceId ? [ws(event.workspaceId)] : [])];
    await emitter.emit(
      rooms,
      'conversation.state_changed',
      envelope(event, 'conversation.state_changed', data),
    );
    done(event);
  };

  // conversation.assigned, agent.transferred and agent.reassigned are one packet for the client (R4): who holds it, who held it.
  const assigned: EventHandler = async (event) => {
    const p = fields(event);
    const conversationId = id(p['conversationId']);
    const to = maybe(p['assignedUserId']) ?? maybe(p['toUserId']);
    const from = maybe(p['fromUserId']);
    const rooms = [
      ...(to ? [user(to)] : []),
      ...(from && from !== to ? [user(from)] : []),
      ...(event.workspaceId ? [ws(event.workspaceId)] : []),
    ];
    const data = { conversationId, assignedUserId: to, previousUserId: from };
    await emitter.emit(
      rooms,
      'conversation.assigned',
      envelope(event, 'conversation.assigned', data),
    );
    done(event);
  };

  return {
    // No packet of its own (spec §3): the Inbox learns of a new conversation from the summary of its first message.
    ...loggingHandlers(log),
    'message.created': messageCreated,
    'conversation.state_changed': stateChanged,
    'conversation.assigned': assigned,
    'agent.transferred': assigned,
    'agent.reassigned': assigned,
  };
}
