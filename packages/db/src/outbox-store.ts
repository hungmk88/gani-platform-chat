import { outboxEvents } from './schema/outbox-events.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';

// Writing and (later) relaying the outbox (outbox spec). Every function takes the caller's TenantTx and never commits: the event is
// one transaction with the data that caused it, so a rollback takes both away.

export interface NewOutboxEvent {
  /** The id of the event: also the `jobId` of the queue, so a duplicate publish is recognised. */
  readonly id: string;
  /** `null` for an event of the organisation as a whole. */
  readonly workspaceId: string | null;
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number | null;
  /** References only (ids, states): no message text and no PII (outbox spec §3). */
  readonly payload: Record<string, unknown>;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly traceId: string;
  readonly occurredAt?: Date;
}

/** Adds a `pending` event in the organisation of the tenant context (never a parameter: CLAUDE.md rule 1). */
export async function insertOutboxEvent(tx: TenantTx, event: NewOutboxEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...event, orgId: currentTenantContext().orgId });
}
