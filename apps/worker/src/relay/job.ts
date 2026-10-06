import type { ClaimedOutboxEvent } from '@gani/db';

/** What goes into the queue for one event: the DomainEvent of Brief P9 (references only, no content), plus its aggregate. */
export interface EventJobData {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly orgId: string;
  readonly workspaceId: string | null;
  readonly occurredAt: string;
  readonly traceId: string;
  readonly actor: { readonly kind: string; readonly id: string | null };
  readonly aggregate: {
    readonly type: string;
    readonly id: string;
    readonly version: number | null;
  };
  readonly payload: unknown;
}

export interface EventJob {
  readonly queue: string;
  /** The id of the event: a second publish of the same event is the same job (outbox spec §5). */
  readonly jobId: string;
  readonly data: EventJobData;
}

/** One queue per workspace, so a busy workspace does not slow another (v2.2 §15); an event of the organisation has its own. */
export function queueNameOf(event: Pick<ClaimedOutboxEvent, 'orgId' | 'workspaceId'>): string {
  return event.workspaceId === null
    ? `q.events.org.${event.orgId}`
    : `q.events.ws.${event.workspaceId}`;
}

export function toJob(event: ClaimedOutboxEvent): EventJob {
  return {
    queue: queueNameOf(event),
    jobId: event.id,
    data: {
      id: event.id,
      type: event.eventType,
      version: event.eventVersion,
      orgId: event.orgId,
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt.toISOString(),
      traceId: event.traceId,
      actor: { kind: event.actorKind, id: event.actorId },
      aggregate: {
        type: event.aggregateType,
        id: event.aggregateId,
        version: event.aggregateVersion,
      },
      payload: event.payload,
    },
  };
}

/** Seconds to wait before the n-th retry (n counts the attempts made): 2, 4, 8, 16, 32, then 60 at most (O7). */
export function backoffSeconds(attempts: number): number {
  return Math.min(2 ** Math.max(attempts, 1), 60);
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'E_QUEUE_DOWN', // raised by our own publisher: no connection, or no answer in time
]);

/** The code stored in `last_error` for a failed publish: the queue is unreachable, or it refused. Never the message (it can name a host). */
export function errorCodeOf(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  const message = error instanceof Error ? error.message : '';
  return CONNECTION_CODES.has(code) ||
    /connection is closed|connect econn|stream isn't writeable|command timed out/i.test(message)
    ? 'E_QUEUE_DOWN'
    : 'E_QUEUE';
}
