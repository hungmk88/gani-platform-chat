import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { orgMembers, type OrgRole } from './schema/org-members.js';
import { workspaceMembers } from './schema/workspace-members.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// Who works in a workspace (N159, Phụ lục B "Cài đặt workspace"), the list that readMemberContext turns into the workspaces of a
// request. Row-level security keeps it to the transaction's organisation; who may change it (an Owner or an Admin) is the caller's
// check. A person leaves with deleted_at (no DELETE); coming back clears it on the same row, as (org, workspace, user) is unique.

export interface WorkspaceMember {
  /** The id of org_members, as `GET /v1/members` names a member. */
  readonly memberId: string;
  readonly userId: string;
  readonly role: OrgRole;
}

const live = and(ne(orgMembers.status, 'pending'), isNull(orgMembers.deletedAt));

/** The members of the workspace `workspaceId` who are still members of the organisation, by role then id. */
export async function listWorkspaceMembers(
  tx: TenantTx,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const rows = await tx
    .select({ memberId: orgMembers.id, userId: orgMembers.userId, role: orgMembers.role })
    .from(workspaceMembers)
    .innerJoin(
      orgMembers,
      and(
        eq(orgMembers.orgId, workspaceMembers.orgId),
        eq(orgMembers.userId, workspaceMembers.userId),
      ),
    )
    .where(
      and(
        eq(workspaceMembers.workspaceId, assertUuid(workspaceId, 'workspaceId')),
        isNull(workspaceMembers.deletedAt),
        live,
      ),
    )
    .orderBy(asc(orgMembers.role), asc(orgMembers.id));
  // CHECK org_members_pending_user_check: a member that is not pending has a user.
  return rows.map((r) => ({ ...r, userId: r.userId as string }));
}

/** The people behind `memberIds` that are members of the organisation (active or suspended, not deleted), by member id. */
export async function membersById(
  tx: TenantTx,
  memberIds: readonly string[],
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: orgMembers.id, userId: orgMembers.userId })
    .from(orgMembers)
    .where(
      and(
        inArray(
          orgMembers.id,
          memberIds.map((id) => assertUuid(id, 'memberId')),
        ),
        live,
      ),
    );
  return new Map(rows.map((r) => [r.id, r.userId as string]));
}

/**
 * Makes `userIds` the people of the workspace (locked by the caller): the others leave (deleted_at), the new ones come in, a returning
 * one on their old row. `newId` makes UUIDv7s for new rows, `actorUserId` is their created_by. Returns how many came and left.
 */
export async function setWorkspaceMembers(
  tx: TenantTx,
  q: {
    readonly workspaceId: string;
    readonly userIds: readonly string[];
    readonly actorUserId: string;
    readonly newId: () => string;
  },
): Promise<{ added: number; removed: number }> {
  const workspaceId = assertUuid(q.workspaceId, 'workspaceId');
  const wanted = new Set(q.userIds.map((id) => assertUuid(id, 'userId')));
  const rows = await tx
    .select({ userId: workspaceMembers.userId, deletedAt: workspaceMembers.deletedAt })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .for('update');
  const now = new Map(rows.map((r) => [r.userId, r.deletedAt === null]));
  const leave = [...now].filter(([user, active]) => active && !wanted.has(user)).map(([u]) => u);
  const back = [...wanted].filter((user) => now.get(user) === false);
  const fresh = [...wanted].filter((user) => !now.has(user));
  const mark = (users: string[], deletedAt: ReturnType<typeof sql> | null) =>
    users.length === 0
      ? Promise.resolve()
      : tx
          .update(workspaceMembers)
          .set({ deletedAt, updatedAt: sql`now()` })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              inArray(workspaceMembers.userId, users),
            ),
          )
          .then(() => undefined);
  await mark(leave, sql`now()`);
  await mark(back, null);
  if (fresh.length > 0)
    await tx.insert(workspaceMembers).values(
      fresh.map((userId) => ({
        id: q.newId(),
        orgId: currentTenantContext().orgId,
        workspaceId,
        userId,
        createdBy: q.actorUserId,
      })),
    );
  return { added: back.length + fresh.length, removed: leave.length };
}
