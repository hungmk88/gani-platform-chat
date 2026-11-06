import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { organizations } from './schema/organizations.js';
import { teamMembers } from './schema/team-members.js';
import { teams } from './schema/teams.js';
import { workspaces } from './schema/workspaces.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

/**
 * The names a person sees of where they work (`GET /v1/me`, U32), and the number customers call for each workspace: every role that
 * uses quick replies fills `{{company_phone}}` with it (U37, N164).
 */
export interface OrgSummary {
  readonly org: { readonly id: string; readonly name: string } | null;
  readonly workspaces: readonly {
    readonly id: string;
    readonly name: string;
    readonly contactPhone: string | null;
  }[];
}

/**
 * The organisation of the surrounding tenant transaction and those of `workspaceIds` that are alive, by name. The organisation is not
 * a parameter: row-level security shows only `app.current_org()`, so an id of another organisation's workspace finds nothing.
 * `workspaceIds` come from `readMemberContext`, never from a request.
 */
export async function readOrgSummary(
  tx: TenantTx,
  workspaceIds: readonly string[],
): Promise<OrgSummary> {
  const [org] = await tx
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(isNull(organizations.deletedAt));
  const rows =
    workspaceIds.length === 0
      ? []
      : await tx
          .select({
            id: workspaces.id,
            name: workspaces.name,
            contactPhone: workspaces.contactPhone,
          })
          .from(workspaces)
          .where(and(inArray(workspaces.id, [...workspaceIds]), isNull(workspaces.deletedAt)))
          .orderBy(asc(workspaces.name), asc(workspaces.id));
  return { org: org ?? null, workspaces: rows };
}

/** A team the person belongs to (U84): `workspaceId` null for a team of the whole organisation. */
export interface OwnTeam {
  readonly id: string;
  readonly name: string;
  readonly workspaceId: string | null;
}

/**
 * The live teams `userId` is a member of, of the organisation's teams or of `workspaceIds`, by name (`GET /v1/me`, U84). Only the
 * person's own: the other teams of a workspace (and their people) are read through `GET /v1/teams`, Owner, Admin and Manager only.
 * `userId` and `workspaceIds` come from the session, never from a request.
 */
export async function listOwnTeams(
  tx: TenantTx,
  userId: string,
  workspaceIds: readonly string[],
): Promise<OwnTeam[]> {
  const t = teams;
  const where =
    workspaceIds.length === 0
      ? isNull(t.workspaceId)
      : or(isNull(t.workspaceId), inArray(t.workspaceId, [...workspaceIds]));
  return tx
    .select({ id: t.id, name: t.name, workspaceId: t.workspaceId })
    .from(t)
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.orgId, t.orgId),
        eq(teamMembers.teamId, t.id),
        isNull(teamMembers.deletedAt),
      ),
    )
    .where(and(eq(teamMembers.userId, assertUuid(userId, 'userId')), isNull(t.deletedAt), where))
    .orderBy(asc(t.name), asc(t.id));
}
