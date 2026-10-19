import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type pg from 'pg';

import { outboxEvents } from './schema/outbox-events.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';

// Writing and relaying the outbox (outbox spec). Every function takes the caller's TenantTx and never commits: the event is one
// transaction with the data that caused it, and the relay's steps are short transactions of their own (claim, then mark).

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

/** An event the relay holds, with what it needs to build the queue job; `attempts` counts this claim (1 the first time). */
// prettier-ignore
export type ClaimedOutboxEvent = Pick<
  typeof outboxEvents.$inferSelect,
  | 'id' | 'orgId' | 'workspaceId' | 'eventType' | 'eventVersion' | 'aggregateType' | 'aggregateId' | 'aggregateVersion'
  | 'payload' | 'actorKind' | 'actorId' | 'traceId' | 'occurredAt' | 'attempts'
>;

/**
 * The organisations that have work for the relay, oldest work first: a due `pending` event, or a `claimed` one older than
 * `leaseSeconds` (a relay died holding it). Asked outside any tenant, through `app.outbox_pending_orgs` (SECURITY DEFINER, ids only);
 * the events themselves are then read one organisation at a time, through RLS.
 */
export async function pendingOrgs(
  pool: pg.Pool,
  limit: number,
  leaseSeconds: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.outbox_pending_orgs($1, $2)',
    [limit, leaseSeconds],
  );
  return rows.map((r) => r.org_id);
}

/** The state of the outbox for the monitoring (outbox spec §7, N118): totals over every organisation that is not deleted. */
export interface OutboxStats {
  readonly pending: number;
  /** How long the oldest `pending` event has waited since it was written; 0 when there is none. */
  readonly oldestPendingAgeSeconds: number;
  readonly deadLetter: number;
}

/** Asked outside any tenant, through `app.outbox_stats` (SECURITY DEFINER, three numbers and nothing else). */
export async function outboxStats(pool: pg.Pool): Promise<OutboxStats> {
  const { rows } = await pool.query<{ pending: string; age: number; dead: string }>(
    'SELECT pending, oldest_pending_age_seconds AS age, dead_letter AS dead FROM app.outbox_stats()',
  );
  const [row] = rows;
  return {
    pending: Number(row?.pending ?? 0),
    oldestPendingAgeSeconds: row?.age ?? 0,
    deadLetter: Number(row?.dead ?? 0),
  };
}

/**
 * Takes up to `limit` due events of the tenant's organisation, oldest first, and marks them `claimed` (`attempts + 1`). `FOR UPDATE
 * SKIP LOCKED` hands two relays that ask at once disjoint batches instead of the same one.
 */
// prettier-ignore
export async function claimOutboxBatch(tx: TenantTx, limit: number): Promise<ClaimedOutboxEvent[]> {
  const due = tx.select({ id: outboxEvents.id }).from(outboxEvents)
    .where(and(eq(outboxEvents.status, 'pending'), lte(outboxEvents.availableAt, sql`now()`)))
    .orderBy(outboxEvents.createdAt, outboxEvents.id).limit(limit).for('update', { skipLocked: true });
  const e = outboxEvents;
  const rows = await tx.update(e)
    .set({ status: 'claimed', claimedAt: sql`now()`, attempts: sql`${e.attempts} + 1` })
    .where(inArray(e.id, due))
    .returning({ id: e.id, orgId: e.orgId, workspaceId: e.workspaceId, eventType: e.eventType, eventVersion: e.eventVersion,
      aggregateType: e.aggregateType, aggregateId: e.aggregateId, aggregateVersion: e.aggregateVersion, payload: e.payload,
      actorKind: e.actorKind, actorId: e.actorId, traceId: e.traceId, occurredAt: e.occurredAt, attempts: e.attempts });
  return rows.sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime() || x.id.localeCompare(y.id));
}

/** The queue took them: `claimed` becomes `published`. Returns how many changed (a row the reaper took back is not counted). */
export async function markOutboxPublished(tx: TenantTx, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx
    .update(outboxEvents)
    .set({ status: 'published', publishedAt: sql`now()` })
    .where(and(inArray(outboxEvents.id, [...ids]), eq(outboxEvents.status, 'claimed')))
    .returning({ id: outboxEvents.id });
  return rows.length;
}

export interface OutboxFailure {
  readonly id: string;
  /** From the claim: how many times it has been tried, this one included. */
  readonly attempts: number;
  /** A code, never a message (the column holds 64 characters at most and no PII). */
  readonly errorCode: string;
  readonly maxAttempts: number;
  readonly retryAfterSeconds: number;
}

/** The queue refused it: back to `pending` after `retryAfterSeconds`, or `dead_letter` once `attempts` reached `maxAttempts`. */
export async function failOutboxEvent(
  tx: TenantTx,
  f: OutboxFailure,
): Promise<'pending' | 'dead_letter' | null> {
  const dead = f.attempts >= f.maxAttempts;
  const [row] = await tx
    .update(outboxEvents)
    .set({
      status: dead ? 'dead_letter' : 'pending',
      claimedAt: null,
      lastError: f.errorCode,
      ...(dead ? {} : { availableAt: sql`now() + make_interval(secs => ${f.retryAfterSeconds})` }),
    })
    .where(and(eq(outboxEvents.id, f.id), eq(outboxEvents.status, 'claimed')))
    .returning({ status: outboxEvents.status });
  return row ? (dead ? 'dead_letter' : 'pending') : null;
}

/**
 * Takes back what a dead relay left `claimed` longer than `leaseSeconds` ago: `pending` again (attempts are not counted twice), or
 * `dead_letter` (`E_LEASE_EXPIRED`) when it has already used `maxAttempts`, so a relay that crashes on every try cannot loop for ever.
 */
export async function reapExpiredOutboxClaims(
  tx: TenantTx,
  leaseSeconds: number,
  maxAttempts: number,
): Promise<number> {
  const rows = await tx
    .update(outboxEvents)
    .set({
      status: sql`CASE WHEN ${outboxEvents.attempts} >= ${maxAttempts} THEN 'dead_letter' ELSE 'pending' END`,
      lastError: sql`CASE WHEN ${outboxEvents.attempts} >= ${maxAttempts} THEN 'E_LEASE_EXPIRED' ELSE ${outboxEvents.lastError} END`,
      claimedAt: null,
    })
    .where(
      and(
        eq(outboxEvents.status, 'claimed'),
        sql`${outboxEvents.claimedAt} < now() - make_interval(secs => ${leaseSeconds})`,
      ),
    )
    .returning({ id: outboxEvents.id });
  return rows.length;
}

/** The runbook step for `dead_letter`: put them (all of the organisation, or `ids`) back to `pending` with a fresh count. */
export async function requeueDeadLetters(tx: TenantTx, ids?: readonly string[]): Promise<number> {
  const rows = await tx
    .update(outboxEvents)
    .set({ status: 'pending', attempts: 0, availableAt: sql`now()`, lastError: null })
    .where(
      and(
        eq(outboxEvents.status, 'dead_letter'),
        ids ? inArray(outboxEvents.id, [...ids]) : undefined,
      ),
    )
    .returning({ id: outboxEvents.id });
  return rows.length;
}
