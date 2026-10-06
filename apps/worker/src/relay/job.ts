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
