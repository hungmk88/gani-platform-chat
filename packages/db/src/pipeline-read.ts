import { and, asc, eq, sql } from 'drizzle-orm';

import { pipelineLostReasons } from './schema/pipelines.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The reasons to lose a lead in force in a workspace (N200 answer 1; CEO 05/11/2026). A list is never edited: a new one (Q9) is a new
// set of rows with a later effective_from, so the list in force is the rows of the latest effective_from that is not in the future.
// Row-level security keeps it to the workspaces of the session (O+W).

/** The names of the list in force at `at` (default: the database's now()), in order; empty when the workspace has none yet. */
export async function lostReasonsInForce(
  tx: TenantTx,
  workspaceId: string,
  at?: Date,
): Promise<string[]> {
  const r = pipelineLostReasons;
  const ws = assertUuid(workspaceId, 'workspaceId');
  const when = at === undefined ? sql`now()` : sql`${at.toISOString()}::timestamptz`;
  const rows = await tx
    .select({ name: r.name })
    .from(r)
    .where(
      and(
        eq(r.workspaceId, ws),
        sql`${r.effectiveFrom} = (SELECT max(l.effective_from) FROM public.pipeline_lost_reasons l
          WHERE l.workspace_id = ${ws} AND l.effective_from <= ${when})`,
      ),
    )
    .orderBy(asc(r.position));
  return rows.map((row) => row.name);
}
