import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { customerMerges, customers } from './schema/customers.js';
import { workspaces } from './schema/workspaces.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// What the API reads around a merge of customers (J3c, N204): the workspaces a merge must reach, and the log of merges. Names come
// through app.org_users (active members, no email); a member who left keeps their id with a null name.

/**
 * Every live workspace of the transaction's organisation (RLS of workspaces is by org only): a merge or an unmerge runs in a second
 * transaction that names them all (N204). A workspace made between the two reads is not reached: rows of the source in it stay with
 * the source, and a second merge moves them (known limit, N206).
 */
export async function liveWorkspaceIds(tx: TenantTx): Promise<string[]> {
  const rows = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(isNull(workspaces.deletedAt))
    .orderBy(workspaces.id);
  return rows.map((r) => r.id);
}

export interface CustomerMergeRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly mergedBy: { readonly id: string; readonly name: string | null };
  readonly mergedAt: Date;
  readonly unmergedAt: Date | null;
}

const m = customerMerges;
const source = alias(customers, 'source');
const record = {
  id: m.id,
  sourceId: m.sourceId,
  targetId: m.targetId,
  mergedById: m.mergedBy,
  mergedByName: sql<
    string | null
  >`(SELECT nullif(btrim(u.display_name), '') FROM app.org_users u WHERE u.user_id = ${m.mergedBy})`,
  mergedAt: m.mergedAt,
  unmergedAt: m.unmergedAt,
};
interface Row extends Omit<CustomerMergeRecord, 'mergedBy'> {
  readonly mergedById: string;
  readonly mergedByName: string | null;
}
const recordOf = ({ mergedById, mergedByName, ...r }: Row): CustomerMergeRecord => ({
  ...r,
  mergedBy: { id: mergedById, name: mergedByName },
});

/** One merge of the organisation, or null. */
export async function loadCustomerMerge(
  tx: TenantTx,
  id: string,
): Promise<CustomerMergeRecord | null> {
  const [row] = await tx
    .select(record)
    .from(m)
    .where(eq(m.id, assertUuid(id, 'id')));
  return row === undefined ? null : recordOf(row);
}

/** The merges into `targetId`, newest first, undone ones too, with the source's name as it is now (null when it has none). */
export async function listCustomerMerges(
  tx: TenantTx,
  targetId: string,
): Promise<(CustomerMergeRecord & { readonly sourceName: string | null })[]> {
  const rows = await tx
    .select({ ...record, sourceName: source.displayName })
    .from(m)
    .innerJoin(source, and(eq(source.orgId, m.orgId), eq(source.id, m.sourceId)))
    .where(eq(m.targetId, assertUuid(targetId, 'targetId')))
    .orderBy(desc(m.mergedAt), desc(m.id));
  return rows.map(({ sourceName, ...row }) => ({ ...recordOf(row), sourceName }));
}
