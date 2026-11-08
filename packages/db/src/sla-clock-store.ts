import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type pg from 'pg';

import { conversations } from './schema/conversations.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The organisations whose SLA clock the opening hours move (E4b, N211), for the job that pauses a running SLA `outside_hours` when a
// workspace closes and runs it again when it opens. Asked outside any tenant through a SECURITY DEFINER function that hands back ids
// only; the job then reads each organisation through RLS.

/** The organisations with a running SLA or one paused `outside_hours`, by id, through `app.sla_running_orgs` (1..1000). */
export async function slaRunningOrgs(pool: pg.Pool, limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.sla_running_orgs($1)',
    [limit],
  );
  return rows.map((r) => r.org_id);
}

/**
 * At most `limit` conversations of the workspace `workspaceId` (of the tenant) whose SLA the hours move now, by id, the oldest first:
 * with `paused` false the running ones (the workspace just closed), with `paused` true those paused `outside_hours` (it just opened).
 */
export async function slaClockConversations(
  tx: TenantTx,
  workspaceId: string,
  paused: boolean,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, assertUuid(workspaceId, 'workspaceId')),
        isNotNull(conversations.slaDueAt),
        paused
          ? eq(conversations.slaPausedReason, 'outside_hours')
          : isNull(conversations.slaPausedReason),
      ),
    )
    .orderBy(asc(conversations.id))
    .limit(limit);
  return rows.map((r) => r.id);
}
