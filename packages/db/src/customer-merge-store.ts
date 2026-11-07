import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { insertAuditLog } from './audit-log.js';
import { conversations } from './schema/conversations.js';
import { customerFieldValues } from './schema/customer-fields.js';
import {
  customerIdentities,
  customerMergeMoves,
  customerMerges,
  customers,
  type MergeMoveTable,
} from './schema/customers.js';
import { leads } from './schema/leads.js';
import { customerTags } from './schema/tags.js';
import { tickets } from './schema/tickets.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The merge of duplicate customers (J3b-1, N204, N205; CEO 06/11 and 07/11/2026); its undoing is J3b-2. The caller's transaction must name every
// live workspace of the organisation (N204): tickets, leads and conversations have RLS by workspace, and a merge that cannot see one
// of them would leave it behind. Both customers are locked in the order of their ids, whoever calls, so a merge and an unmerge of the
// same pair, or two merges crossing each other, wait instead of deadlocking. The log (customer_merge_moves) names every row moved, so
// the unmerge gives back exactly those; what was made after the merge stays with the target. Only ids reach the audit, never a name,
// phone or email (CLAUDE.md rule 5).

/** The source or the target is not a live, unmerged customer of the organisation (404). */
export class CustomerMergeNotFoundError extends Error {
  readonly code = 'not_found';
  constructor() {
    super('customer not found');
  }
}

/** Each table a merge moves, mapped here and only here: the table name of the log never reaches SQL as an identifier. */
const MOVED = {
  conversations,
  customer_identities: customerIdentities,
  tickets,
  leads,
  customer_tags: customerTags,
  customer_field_values: customerFieldValues,
} as const satisfies Record<MergeMoveTable, unknown>;

const FILLABLE = ['display_name', 'phone_e164', 'email'] as const;
type Fillable = (typeof FILLABLE)[number];
const COLUMN = { display_name: 'displayName', phone_e164: 'phoneE164', email: 'email' } as const;

interface Locked {
  readonly id: string;
  readonly deletedAt: Date | null;
  readonly mergedInto: string | null;
  readonly displayName: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
}

/** Locks the customers `ids` FOR UPDATE, always by id, and returns them by id. */
async function lockCustomers(tx: TenantTx, ids: readonly string[]): Promise<Map<string, Locked>> {
  const c = customers;
  const rows = await tx
    .select({
      id: c.id,
      deletedAt: c.deletedAt,
      mergedInto: c.mergedInto,
      displayName: c.displayName,
      phoneE164: c.phoneE164,
      email: c.email,
    })
    .from(c)
    .where(inArray(c.id, [...ids]))
    .orderBy(c.id)
    .for('update');
  return new Map(rows.map((r) => [r.id, r]));
}

/** Moves the rows of `table` from `from` to `to` and returns their ids. */
async function move(
  tx: TenantTx,
  table: MergeMoveTable,
  from: string,
  to: string,
): Promise<string[]> {
  const t = MOVED[table];
  const where = [eq(t.customerId, from)];
  // A tag or a field value the target already has stays with the source (the target keeps its own), and comes back with an unmerge.
  if (table === 'customer_tags') {
    const own = alias(customerTags, 'own');
    where.push(
      notExists(
        tx
          .select({ one: sql`1` })
          .from(own)
          .where(and(eq(own.customerId, to), eq(own.tagId, customerTags.tagId))),
      ),
    );
  } else if (table === 'customer_field_values') {
    const own = alias(customerFieldValues, 'own');
    where.push(
      notExists(
        tx
          .select({ one: sql`1` })
          .from(own)
          .where(and(eq(own.customerId, to), eq(own.fieldId, customerFieldValues.fieldId))),
      ),
    );
  }
  const rows = await tx
    .update(t)
    .set({ customerId: to })
    .where(and(...where))
    .returning({ id: t.id });
  return rows.map((r) => r.id);
}

/**
 * Merges `sourceId` into `targetId`: conversations, identities, tickets and leads move; a tag or a custom field value moves when the
 * target has none of it; a name, phone or email fills the target only where it is empty. The source is marked merged (hidden from
 * the lists), never deleted. Throws CustomerMergeNotFoundError when either is not a live, unmerged customer of the organisation.
 */
export async function mergeCustomers(
  tx: TenantTx,
  m: {
    readonly sourceId: string;
    readonly targetId: string;
    readonly actorUserId: string;
    readonly newId: () => string;
  },
): Promise<{ readonly mergeId: string }> {
  const sourceId = assertUuid(m.sourceId, 'sourceId');
  const targetId = assertUuid(m.targetId, 'targetId');
  if (sourceId === targetId) throw new CustomerMergeNotFoundError();
  const locked = await lockCustomers(tx, [sourceId, targetId]);
  const source = locked.get(sourceId);
  const target = locked.get(targetId);
  const live = (x: Locked | undefined): x is Locked =>
    x !== undefined && x.deletedAt === null && x.mergedInto === null;
  if (!live(source) || !live(target)) throw new CustomerMergeNotFoundError();

  const filled: Fillable[] = FILLABLE.filter(
    (f) => target[COLUMN[f]] === null && source[COLUMN[f]] !== null,
  );
  const { orgId } = currentTenantContext();
  const mergeId = assertUuid(m.newId(), 'newId');
  await tx.insert(customerMerges).values({
    id: mergeId,
    orgId,
    sourceId,
    targetId,
    mergedBy: assertUuid(m.actorUserId, 'actorUserId'),
    filledFields: filled,
  });
  for (const table of Object.keys(MOVED) as MergeMoveTable[]) {
    const ids = await move(tx, table, sourceId, targetId);
    if (ids.length > 0)
      await tx
        .insert(customerMergeMoves)
        .values(ids.map((rowId) => ({ id: m.newId(), orgId, mergeId, tableName: table, rowId })));
  }
  const fill = Object.fromEntries(filled.map((f) => [COLUMN[f], source[COLUMN[f]]]));
  const now = new Date();
  await tx
    .update(customers)
    .set({ ...fill, updatedAt: now })
    .where(eq(customers.id, targetId));
  await tx
    .update(customers)
    .set({ mergedInto: targetId, mergedAt: now, updatedAt: now })
    .where(eq(customers.id, sourceId));
  await insertAuditLog(tx, {
    id: m.newId(),
    actorUserId: m.actorUserId,
    action: 'customer.merged',
    targetType: 'customer',
    targetId,
    detail: { mergeId, sourceId, targetId },
  });
  return { mergeId };
}
