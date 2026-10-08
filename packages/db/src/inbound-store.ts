import { and, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type pg from 'pg';

import { inboundEventKeys } from './schema/inbound-event-keys.js';
import { inboundEvents } from './schema/inbound-events.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';

// Writing and taking inbound events (inbound spec §1-§3, N106). Every function takes the caller's TenantTx and never commits: the
// webhook writes the key and the event in one transaction, and the worker's steps are short transactions of their own (claim, then
// process and mark). The organisation always comes from the tenant context (CLAUDE.md rule 1), never from a parameter. This file
// only moves rows: what an event means (classify, normalise, write the message) belongs to the processor, not here. It logs nothing.

/** A code, never a message: a name or a phone number must not reach `last_error` or a log. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
function assertErrorCode(code: string): void {
  // The error does not repeat the value: it may be the very text this check is there to keep out.
  if (!ERROR_CODE.test(code)) {
    throw new TypeError('error code must match ^[A-Z][A-Z0-9_]{0,63}$ (a code, never a message)');
  }
}

function assertWhole(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be a whole number of at least ${min}`);
  }
}

/** Which event a row is: `id` is unique, `receivedAt` is the partition key and lets the database look in one month only. */
export interface InboundEventKey {
  readonly id: string;
  readonly receivedAt: Date;
}

// received_at has microseconds in the database and a Date has milliseconds, so a Date read from a row is up to 1 ms below the
// stored value and `received_at = date` would match nothing. The row is in [receivedAt, receivedAt + 1 ms): still one partition.
function isEvent(key: InboundEventKey) {
  const e = inboundEvents;
  return and(
    eq(e.id, key.id),
    gte(e.receivedAt, key.receivedAt),
    lt(e.receivedAt, new Date(key.receivedAt.getTime() + 1)),
  );
}

export interface NewInboundEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly channelAccountId: string;
  /** The id the platform gives the event, or `raw:` + sha256 of the raw body when it gives none (I5). */
  readonly platformMessageId: string;
  readonly eventType: string;
  /** The body of the event. It holds what the customer wrote: PII. */
  readonly payload: Record<string, unknown>;
  /** When it was received. Absent: the database's `now()`. */
  readonly receivedAt?: Date;
}

/**
 * Records an event once. The key goes first, with `ON CONFLICT DO NOTHING`: no row inserted means the platform sent it again, and the
 * event is NOT written (`'duplicate'`). Otherwise the event is written in the same transaction (`'inserted'`), so if that fails the key
 * goes with it. A second webhook for the same key waits for the first to commit, then sees the duplicate. The key table is what stops
 * duplicates; `inbound_events` cannot, as it is partitioned by month (I1).
 */
export async function insertIfAbsent(
  tx: TenantTx,
  event: NewInboundEvent,
): Promise<'inserted' | 'duplicate'> {
  const { orgId } = currentTenantContext();
  const key = await tx
    .insert(inboundEventKeys)
    .values({
      orgId,
      channelAccountId: event.channelAccountId,
      platformMessageId: event.platformMessageId,
    })
    .onConflictDoNothing()
    .returning({ platformMessageId: inboundEventKeys.platformMessageId });
  if (key.length === 0) return 'duplicate';
  await tx.insert(inboundEvents).values({ ...event, orgId });
  return 'inserted';
}

/**
 * The workspaces of the tenant's organisation that have an event due (`pending`, `available_at` passed), the one waiting longest first.
 * The worker takes a few events per workspace and goes round them, so a workspace that floods does not hold the others back
 * (Phụ lục §15, Brief P16). A caller that skips this and claims without a workspace gives up that fairness.
 */
export async function pendingInboundWorkspaces(tx: TenantTx): Promise<string[]> {
  const e = inboundEvents;
  const oldest = sql`min(${e.receivedAt})`;
  const rows = await tx
    .select({ workspaceId: e.workspaceId })
    .from(e)
    .where(and(eq(e.status, 'pending'), lte(e.availableAt, sql`now()`)))
    .groupBy(e.workspaceId)
    .orderBy(oldest, e.workspaceId);
  return rows.map((r) => r.workspaceId);
}

/**
 * An event the worker holds, with what it needs to process it; `attempts` counts this claim (1 the first time).
 * `payload` is what the customer wrote: PII. Do not log it, and do not put any of it in an error.
 */
// prettier-ignore
export type ClaimedInboundEvent = Pick<
  typeof inboundEvents.$inferSelect,
  'id' | 'orgId' | 'workspaceId' | 'channelAccountId' | 'platformMessageId' | 'eventType' | 'payload' | 'receivedAt' | 'attempts'
>;

/**
 * Takes up to `limit` due events of the tenant's organisation (of one workspace when `workspaceId` is given), oldest first, and marks
 * them `claimed` (`attempts + 1`). `FOR UPDATE SKIP LOCKED` hands two workers that ask at once disjoint batches instead of the same one.
 */
// prettier-ignore
export async function claimInboundBatch(
  tx: TenantTx,
  options: { readonly limit: number; readonly workspaceId?: string },
): Promise<ClaimedInboundEvent[]> {
  const { limit, workspaceId } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError('limit must be a whole number between 1 and 1000');
  }
  const e = inboundEvents;
  const due = tx.select({ id: e.id }).from(e)
    .where(and(eq(e.status, 'pending'), lte(e.availableAt, sql`now()`), workspaceId ? eq(e.workspaceId, workspaceId) : undefined))
    .orderBy(e.receivedAt, e.id).limit(limit).for('update', { skipLocked: true });
  const rows = await tx.update(e)
    .set({ status: 'claimed', claimedAt: sql`now()`, attempts: sql`${e.attempts} + 1` })
    .where(inArray(e.id, due))
    .returning({ id: e.id, orgId: e.orgId, workspaceId: e.workspaceId, channelAccountId: e.channelAccountId,
      platformMessageId: e.platformMessageId, eventType: e.eventType, payload: e.payload, receivedAt: e.receivedAt, attempts: e.attempts });
  return rows.sort((x, y) => x.receivedAt.getTime() - y.receivedAt.getTime() || x.id.localeCompare(y.id));
}

/**
 * The event was processed: `claimed` becomes `processed`.
 *
 * `false` means the worker no longer holds it (its lease ran out and the event went back, maybe to another worker). **The caller MUST
 * then ROLL BACK the whole transaction**, the message and the state change included (inbound spec §3 step 6): committing would keep
 * a message whose event someone else will process again, and that is two messages for one event.
 */
export async function markInboundProcessed(tx: TenantTx, key: InboundEventKey): Promise<boolean> {
  const rows = await tx
    .update(inboundEvents)
    .set({ status: 'processed', processedAt: sql`now()` })
    .where(and(isEvent(key), eq(inboundEvents.status, 'claimed')))
    .returning({ id: inboundEvents.id });
  return rows.length === 1;
}

/**
 * The event is not a message to process (a follow, a system event): `claimed` becomes `ignored`, with the code of the reason in
 * `last_error` (a code only: it is checked). `false` means the lease was lost: the caller MUST roll back, as for `markInboundProcessed`.
 */
export async function markInboundIgnored(
  tx: TenantTx,
  key: InboundEventKey,
  reasonCode: string,
): Promise<boolean> {
  assertErrorCode(reasonCode);
  const rows = await tx
    .update(inboundEvents)
    .set({ status: 'ignored', processedAt: sql`now()`, lastError: reasonCode })
    .where(and(isEvent(key), eq(inboundEvents.status, 'claimed')))
    .returning({ id: inboundEvents.id });
  return rows.length === 1;
}

export interface InboundFailure extends InboundEventKey {
  /** From the claim: how many times it has been tried, this one included. It names the claim that failed (see below). */
  readonly attempts: number;
  /** A code, never a message: checked, and never repeated in an error. */
  readonly errorCode: string;
  readonly maxAttempts: number;
  /** Chosen by the caller (the backoff is its policy, not the store's). */
  readonly retryAfterSeconds: number;
}

/**
 * The processing failed: back to `pending` after `retryAfterSeconds`, or `dead_letter` once `attempts` reached `maxAttempts`. The
 * code stays in `last_error` (also for a dead letter, to tell the runbook why). `attempts` is not raised: the claim did that.
 *
 * Only the claim that is being failed is touched: the row must still be `claimed` AND at the same `attempts`. Without the second
 * test, a worker whose lease was taken back could fail the claim of the worker that took the event after it. `null`: not the
 * claim of this worker any more.
 */
export async function failInboundEvent(
  tx: TenantTx,
  failure: InboundFailure,
): Promise<'pending' | 'dead_letter' | null> {
  assertErrorCode(failure.errorCode);
  assertWhole('attempts', failure.attempts, 1);
  assertWhole('maxAttempts', failure.maxAttempts, 1);
  assertWhole('retryAfterSeconds', failure.retryAfterSeconds, 0);
  const dead = failure.attempts >= failure.maxAttempts;
  const e = inboundEvents;
  const [row] = await tx
    .update(e)
    .set({
      status: dead ? 'dead_letter' : 'pending',
      claimedAt: null,
      lastError: failure.errorCode,
      ...(dead
        ? {}
        : { availableAt: sql`now() + make_interval(secs => ${failure.retryAfterSeconds})` }),
    })
    .where(and(isEvent(failure), eq(e.status, 'claimed'), eq(e.attempts, failure.attempts)))
    .returning({ status: e.status });
  return row ? (dead ? 'dead_letter' : 'pending') : null;
}

/**
 * Takes back what a dead worker left `claimed` longer than `leaseSeconds` ago: `pending` again (`attempts` is not counted twice), or
 * `dead_letter` (`E_LEASE_EXPIRED`) when it has already used `maxAttempts`, so a worker that crashes on every try cannot loop for ever.
 */
export async function reapExpiredInboundClaims(
  tx: TenantTx,
  leaseSeconds: number,
  maxAttempts: number,
): Promise<number> {
  assertWhole('leaseSeconds', leaseSeconds, 1);
  assertWhole('maxAttempts', maxAttempts, 1);
  const e = inboundEvents;
  const rows = await tx
    .update(e)
    .set({
      status: sql`CASE WHEN ${e.attempts} >= ${maxAttempts} THEN 'dead_letter' ELSE 'pending' END`,
      lastError: sql`CASE WHEN ${e.attempts} >= ${maxAttempts} THEN 'E_LEASE_EXPIRED' ELSE ${e.lastError} END`,
      claimedAt: null,
    })
    .where(
      and(
        eq(e.status, 'claimed'),
        sql`${e.claimedAt} < now() - make_interval(secs => ${leaseSeconds})`,
      ),
    )
    .returning({ id: e.id });
  return rows.length;
}

/**
 * The runbook step for `dead_letter`: puts them (all of the organisation, or the given `keys`) back to `pending` with a fresh count and
 * no error. An empty `keys` means none, not all.
 */
export async function requeueInboundDeadLetters(
  tx: TenantTx,
  keys?: readonly InboundEventKey[],
): Promise<number> {
  if (keys?.length === 0) return 0;
  const rows = await tx
    .update(inboundEvents)
    .set({ status: 'pending', attempts: 0, availableAt: sql`now()`, lastError: null })
    .where(
      and(
        eq(inboundEvents.status, 'dead_letter'),
        keys ? or(...keys.map((key) => isEvent(key))) : undefined,
      ),
    )
    .returning({ id: inboundEvents.id });
  return rows.length;
}

/**
 * The organisations that have inbound work for the worker, oldest work first: a due `pending` event, or a `claimed` one older than
 * `leaseSeconds`. Asked outside any tenant, through `app.inbound_pending_orgs` (SECURITY DEFINER, ids only; it checks its own bounds);
 * the events are then read one organisation at a time, through RLS.
 */
export async function pendingInboundOrgs(
  pool: pg.Pool,
  limit: number,
  leaseSeconds: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.inbound_pending_orgs($1, $2)',
    [limit, leaseSeconds],
  );
  return rows.map((r) => r.org_id);
}

/**
 * Removes the keys that stop duplicates once they are older than `retentionDays`, at most `limit` of them, for every organisation
 * (`app.purge_inbound_event_keys`, SECURITY DEFINER; it refuses less than 30 days and a limit outside 1..10000 with 22023). Returns
 * how many it removed; the caller asks again until it gets 0.
 */
export async function purgeInboundEventKeys(
  pool: pg.Pool,
  retentionDays: number,
  limit: number,
): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    'SELECT app.purge_inbound_event_keys($1, $2) AS removed',
    [retentionDays, limit],
  );
  return rows[0]?.removed ?? 0;
}
