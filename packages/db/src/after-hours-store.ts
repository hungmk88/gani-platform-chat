import { and, asc, eq } from 'drizzle-orm';
import type pg from 'pg';

import { conversations } from './schema/conversations.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The conversations held outside business hours (after_hours_hold, T03, Brief F6; C10-4b) for the job that releases them when their
// workspace opens (T08). Only reads: the release goes through the ConversationStateMachine, never here. The first function runs
// outside any tenant through a SECURITY DEFINER function that hands back ids only; the job then lists the organisation's workspaces
// (listWorkspaces) and reads each in a tenant of that workspace: row-level security of conversations is by organisation and workspace.

/** The organisations that hold a conversation, by id, asked outside any tenant through `app.after_hours_held_orgs` (1..1000). */
export async function afterHoursHeldOrgs(pool: pg.Pool, limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.after_hours_held_orgs($1)',
    [limit],
  );
  return rows.map((r) => r.org_id);
}

/** At most `limit` conversations held in the workspace `workspaceId` (of the tenant), by id: the oldest first, ids being UUIDv7. */
export async function afterHoursHeldConversations(
  tx: TenantTx,
  workspaceId: string,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, assertUuid(workspaceId, 'workspaceId')),
        eq(conversations.afterHoursHold, true),
      ),
    )
    .orderBy(asc(conversations.id))
    .limit(limit);
  return rows.map((r) => r.id);
}
