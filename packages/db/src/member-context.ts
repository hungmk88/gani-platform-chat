import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { orgMembers, type OrgRole } from './schema/org-members.js';
import { teamMembers } from './schema/team-members.js';
import { workspaceMembers } from './schema/workspace-members.js';
import { workspaces } from './schema/workspaces.js';
import type { TenantTx } from './tenant-tx.js';

/** What a person is inside one organisation: the role and the workspaces they belong to. */
export interface MemberContext {
  readonly role: OrgRole;
  readonly workspaceIds: readonly string[];
}

/**
 * Role and workspaces of `userId` in the organisation of the surrounding tenant transaction, or `null` when they are not an
 * ACTIVE, not deleted member of it (left, suspended, or never was). The organisation is not a parameter: row-level security
 * filters both tables by `app.current_org()`, so asking about a person in another organisation finds nothing instead of
 * leaking it. A workspace that was soft-deleted, or whose membership was, is not listed. Ids come back sorted.
 */
export async function readMemberContext(
  tx: TenantTx,
  userId: string,
): Promise<MemberContext | null> {
  const [member] = await tx
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.status, 'active'),
        isNull(orgMembers.deletedAt),
      ),
    );
  if (!member) return null;
  const rows = await tx
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    );
  return { role: member.role, workspaceIds: rows.map((r) => r.id).sort() };
}

/** Do `a` and `b` belong to one team (neither membership soft-deleted)? Phụ lục B "Team" for a transfer by sales or support. */
export async function shareTeam(tx: TenantTx, a: string, b: string): Promise<boolean> {
  const other = alias(teamMembers, 'other');
  const rows = await tx
    .select({ team: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(other, and(eq(other.orgId, teamMembers.orgId), eq(other.teamId, teamMembers.teamId)))
    .where(
      and(
        eq(teamMembers.userId, a),
        eq(other.userId, b),
        isNull(teamMembers.deletedAt),
        isNull(other.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
