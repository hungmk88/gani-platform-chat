import { sql } from 'drizzle-orm';

import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/** What a person did to their own account (N162). */
export type AccountEvent = 'user.password_changed' | 'user.password_reset';

/**
 * Logs `action` of the signed-in person in each of `orgIds` where they are still an active member, one row each with an id from
 * `newId` (UUIDv7), through app.audit_own_account_event (SECURITY DEFINER, ADR-004). Runs inside withAuthUser: the person is the one the
 * transaction names, never an argument. Returns how many organisations got a row.
 */
export async function auditOwnAccountEvent(
  tx: TenantTx,
  q: {
    readonly action: AccountEvent;
    readonly orgIds: readonly string[];
    readonly newId: () => string;
  },
): Promise<number> {
  const orgIds = q.orgIds.map((id) => assertUuid(id, 'orgId'));
  const ids = orgIds.map(() => assertUuid(q.newId(), 'id'));
  const rows = await tx.execute<{ written: number }>(
    sql`SELECT app.audit_own_account_event(${q.action}, ${`{${orgIds.join(',')}}`}::uuid[], ${`{${ids.join(',')}}`}::uuid[]) AS written`,
  );
  // The function returns a count, never NULL.
  return (rows.rows[0] as { written: number }).written;
}
