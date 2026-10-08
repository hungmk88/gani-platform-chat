import { and, eq, lte, sql } from 'drizzle-orm';

import { inboundEventKeys } from './schema/inbound-event-keys.js';
import { inboundEvents } from './schema/inbound-events.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';

// Writing and taking inbound events (inbound spec §1-§3, N106). Every function takes the caller's TenantTx and never commits: the
// webhook writes the key and the event in one transaction, and the worker's steps are short transactions of their own (claim, then
// process and mark). The organisation always comes from the tenant context (CLAUDE.md rule 1), never from a parameter. This file
// only moves rows: what an event means (classify, normalise, write the message) belongs to the processor, not here. It logs nothing.

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
