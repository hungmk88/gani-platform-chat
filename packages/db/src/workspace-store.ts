import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { workspaces } from './schema/workspaces.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The workspaces of the transaction's organisation for the screen /settings/workspace (Brief P9 `GET /v1/workspaces`, spec-M8 §3.4,
// N157). Row-level security shows only app.current_org(); who may read or change them (an Owner or an Admin) is the caller's check.

export interface WorkspaceRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly template: 'b2b_sales' | 'b2c_order' | 'service';
  readonly timezone: string;
  readonly defaultMaxConcurrent: number;
  readonly createdAt: Date;
}

/** What an Owner or an Admin may change of a workspace; the slug and the template stay as created (spec-M8 A2). */
export interface WorkspaceChange {
  readonly name?: string;
  readonly timezone?: string;
  readonly defaultMaxConcurrent?: number;
}

const columns = {
  id: workspaces.id,
  slug: workspaces.slug,
  name: workspaces.name,
  template: workspaces.template,
  timezone: workspaces.timezone,
  defaultMaxConcurrent: workspaces.defaultMaxConcurrent,
  createdAt: workspaces.createdAt,
};

/** The organisation's workspaces that are not deleted, by name; at most 200 (an organisation has a handful). */
export async function listWorkspaces(tx: TenantTx): Promise<WorkspaceRow[]> {
  return tx
    .select(columns)
    .from(workspaces)
    .where(isNull(workspaces.deletedAt))
    .orderBy(asc(workspaces.name), asc(workspaces.id))
    .limit(200);
}

/** The workspace `id` (not deleted), locked until the end of the transaction, or null. */
export async function lockWorkspace(tx: TenantTx, id: string): Promise<WorkspaceRow | null> {
  const [row] = await tx
    .select(columns)
    .from(workspaces)
    .where(and(eq(workspaces.id, assertUuid(id, 'id')), isNull(workspaces.deletedAt)))
    .for('update');
  return row ?? null;
}

/** Applies `change` to the workspace `id`, locked before by lockWorkspace, and returns it as it now is. */
export async function updateWorkspace(
  tx: TenantTx,
  id: string,
  change: WorkspaceChange,
): Promise<WorkspaceRow> {
  const [row] = await tx
    .update(workspaces)
    .set({ ...change, updatedAt: sql`now()` })
    .where(eq(workspaces.id, assertUuid(id, 'id')))
    .returning(columns);
  // Locked by the caller, so it is still there.
  return row as WorkspaceRow;
}
