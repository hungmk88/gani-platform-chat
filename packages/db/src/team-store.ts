import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';

import { teamMembers } from './schema/team-members.js';
import { teams } from './schema/teams.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// Teams of a workspace for /settings/teams (A4, spec-M8 §3.1, endpoint-M8 §1, N160). Row-level security keeps them to the
// transaction's organisation; who may read or change them is the caller's check. Nothing is deleted: a team and its memberships end
// with deleted_at. The caller locks the workspace (lockWorkspace) before it makes a team or changes the default one, so two of those
// in one workspace take turns.

export interface TeamRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly isDefault: boolean;
  /** People in the team who are still members of the organisation. */
  readonly memberCount: number;
  readonly createdAt: Date;
}

/** What may change of a team; the slug stays as made. */
export interface TeamChange {
  readonly name?: string;
  readonly description?: string | null;
  readonly isDefault?: boolean;
}

// Written out with the table's own name: drizzle prints a column of the one selected table without it, which the subquery's
// tables make ambiguous.
const liveMembers = sql<number>`(
  SELECT count(*)::int FROM public.team_members tm
  JOIN public.org_members om ON om.org_id = tm.org_id AND om.user_id = tm.user_id
  WHERE tm.org_id = teams.org_id AND tm.team_id = teams.id AND tm.deleted_at IS NULL
    AND om.deleted_at IS NULL AND om.status <> 'pending')`;

const columns = {
  id: teams.id,
  workspaceId: teams.workspaceId,
  name: teams.name,
  slug: teams.slug,
  description: teams.description,
  isDefault: teams.isDefault,
  memberCount: liveMembers,
  createdAt: teams.createdAt,
};
// Company-wide teams (workspace_id NULL, N14) are not served yet: every query here names a workspace.
const asRow = (r: { workspaceId: string | null } & Omit<TeamRow, 'workspaceId'>): TeamRow => ({
  ...r,
  workspaceId: r.workspaceId as string,
});

/** The live teams of a workspace by name; with `memberUserId`, only those that person belongs to (a Manager's own, N160). */
export async function listTeams(
  tx: TenantTx,
  q: { readonly workspaceId: string; readonly memberUserId?: string },
): Promise<TeamRow[]> {
  const where: SQL[] = [
    eq(teams.workspaceId, assertUuid(q.workspaceId, 'workspaceId')),
    isNull(teams.deletedAt),
  ];
  if (q.memberUserId !== undefined)
    where.push(sql`EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.org_id = teams.org_id
      AND tm.team_id = teams.id AND tm.user_id = ${assertUuid(q.memberUserId, 'memberUserId')}::uuid
      AND tm.deleted_at IS NULL)`);
  const rows = await tx
    .select(columns)
    .from(teams)
    .where(and(...where))
    .orderBy(asc(teams.name), asc(teams.id))
    .limit(200);
  return rows.map(asRow);
}

/** The live team `id` of a workspace, locked until the end of the transaction, or null. */
export async function lockTeam(tx: TenantTx, id: string): Promise<TeamRow | null> {
  const [row] = await tx
    .select(columns)
    .from(teams)
    .where(
      and(
        eq(teams.id, assertUuid(id, 'id')),
        isNull(teams.deletedAt),
        sql`${teams.workspaceId} IS NOT NULL`,
      ),
    )
    .for('update', { of: teams });
  return row ? asRow(row) : null;
}

/** `name` as a slug (no accent, lower case, dashes), 2–58 characters; `team` when nothing is left. */
export function slugOf(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'team';
}

/** Makes a team in a workspace (locked by the caller) with a free slug from its name: `ban-si`, then `ban-si-2`, … */
export async function createTeam(
  tx: TenantTx,
  q: {
    readonly id: string;
    readonly workspaceId: string;
    readonly name: string;
    readonly description: string | null;
    readonly createdBy: string;
  },
): Promise<TeamRow> {
  const workspaceId = assertUuid(q.workspaceId, 'workspaceId');
  const base = slugOf(q.name);
  // Deleted teams count: a slug once used is not reused (N62).
  const taken = new Set(
    (
      await tx
        .select({ slug: teams.slug })
        .from(teams)
        .where(and(eq(teams.workspaceId, workspaceId), sql`${teams.slug} LIKE ${`${base}%`}`))
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  await tx.insert(teams).values({
    id: assertUuid(q.id, 'id'),
    orgId: currentTenantContext().orgId,
    workspaceId,
    name: q.name,
    slug,
    description: q.description,
    createdBy: q.createdBy,
  });
  return (await lockTeam(tx, q.id)) as TeamRow;
}

/** Applies `change` to a team locked before; a new default first takes the flag from the workspace's old default. */
export async function updateTeam(
  tx: TenantTx,
  team: TeamRow,
  change: TeamChange,
): Promise<TeamRow> {
  if (change.isDefault === true)
    await tx
      .update(teams)
      .set({ isDefault: false, updatedAt: sql`now()` })
      .where(
        and(
          eq(teams.workspaceId, team.workspaceId),
          eq(teams.isDefault, true),
          ne(teams.id, team.id),
        ),
      );
  await tx
    .update(teams)
    .set({ ...change, updatedAt: sql`now()` })
    .where(eq(teams.id, team.id));
  return (await lockTeam(tx, team.id)) as TeamRow;
}

/** Ends a team locked before and every membership in it (deleted_at). */
export async function deleteTeam(tx: TenantTx, id: string): Promise<void> {
  const teamId = assertUuid(id, 'id');
  await tx
    .update(teamMembers)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.deletedAt)));
  await tx
    .update(teams)
    .set({ deletedAt: sql`now()`, isDefault: false, updatedAt: sql`now()` })
    .where(eq(teams.id, teamId));
}

/** The people of a team, by user id. */
export async function teamUserIds(tx: TenantTx, id: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, assertUuid(id, 'id')), isNull(teamMembers.deletedAt)))
    .orderBy(asc(teamMembers.userId));
  return rows.map((r) => r.userId);
}

/**
 * Makes `userIds` the people of a team (locked by the caller): the others leave (deleted_at), the new ones come in, a returning one on
 * their old row. Returns how many came and left.
 */
export async function setTeamMembers(
  tx: TenantTx,
  q: {
    readonly teamId: string;
    readonly userIds: readonly string[];
    readonly actorUserId: string;
    readonly newId: () => string;
  },
): Promise<{ added: number; removed: number }> {
  const teamId = assertUuid(q.teamId, 'teamId');
  const wanted = new Set(q.userIds.map((id) => assertUuid(id, 'userId')));
  const rows = await tx
    .select({ userId: teamMembers.userId, deletedAt: teamMembers.deletedAt })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
    .for('update');
  const now = new Map(rows.map((r) => [r.userId, r.deletedAt === null]));
  const leave = [...now].filter(([user, active]) => active && !wanted.has(user)).map(([u]) => u);
  const back = [...wanted].filter((user) => now.get(user) === false);
  const fresh = [...wanted].filter((user) => !now.has(user));
  for (const [users, deletedAt] of [
    [leave, sql`now()`],
    [back, null],
  ] as const)
    if (users.length > 0)
      await tx
        .update(teamMembers)
        .set({ deletedAt, updatedAt: sql`now()` })
        .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.userId, users)));
  if (fresh.length > 0)
    await tx.insert(teamMembers).values(
      fresh.map((userId) => ({
        id: q.newId(),
        orgId: currentTenantContext().orgId,
        teamId,
        userId,
        createdBy: q.actorUserId,
      })),
    );
  return { added: back.length + fresh.length, removed: leave.length };
}
