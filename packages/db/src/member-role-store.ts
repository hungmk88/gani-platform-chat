import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';

import { orgMembers, type OrgRole } from './schema/org-members.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The change of a member's role (PATCH /v1/members/{id}/role, N154), in the caller's TenantTx. The caller locks the Owners first, then
// the member, always in this order (each by id), so two changes at once take turns instead of deadlocking, and an organisation is
// never left without an active Owner: the second of two Owners demoting each other finds one Owner left, the one it would remove.

/** The ids of the active Owners of the organisation of the transaction, locked until its end. */
export async function lockActiveOwners(tx: TenantTx): Promise<string[]> {
  const rows = await tx
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.role, 'owner'),
        eq(orgMembers.status, 'active'),
        isNull(orgMembers.deletedAt),
      ),
    )
    .orderBy(asc(orgMembers.id))
    .for('update');
  return rows.map((r) => r.id);
}

/** The member `id` (not an invitation, not deleted), locked until the end of the transaction, or null. */
export async function lockMember(
  tx: TenantTx,
  id: string,
): Promise<{ readonly id: string; readonly userId: string; readonly role: OrgRole } | null> {
  const [row] = await tx
    .select({ id: orgMembers.id, userId: orgMembers.userId, role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.id, assertUuid(id, 'id')),
        ne(orgMembers.status, 'pending'),
        isNull(orgMembers.deletedAt),
      ),
    )
    .for('update');
  // CHECK org_members_pending_user_check: a member that is not pending has a user.
  return row ? { id: row.id, userId: row.userId as string, role: row.role } : null;
}

/** Sets the role of the member `id`, locked before by lockMember. */
export async function updateMemberRole(tx: TenantTx, id: string, role: OrgRole): Promise<void> {
  await tx
    .update(orgMembers)
    .set({ role, updatedAt: sql`now()` })
    .where(eq(orgMembers.id, assertUuid(id, 'id')));
}
