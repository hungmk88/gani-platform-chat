import { and, asc, inArray, isNull } from 'drizzle-orm';

import { organizations } from './schema/organizations.js';
import { workspaces } from './schema/workspaces.js';
import type { TenantTx } from './tenant-tx.js';

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
