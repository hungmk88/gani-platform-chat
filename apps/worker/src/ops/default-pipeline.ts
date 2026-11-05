import type { Queryable } from './create-org.js';

// The default pipeline of a workspace (N196, N200; CEO 05/11/2026), for every template: six steps named only by their place, and one
// reason to lose a lead, so that a lost lead can be closed at once. Both are stand-ins until Q9 gives the real ones: no business name
// is written here. Q9 replaces the reasons with a new list at a later effective_from (never an edit of these rows) and the steps by a
// command of its own.

/** "Bước 1"…"Bước 6", at positions 0…5 (Q9: the names of the steps). */
export const DEFAULT_STAGES = ['Bước 1', 'Bước 2', 'Bước 3', 'Bước 4', 'Bước 5', 'Bước 6'] as const;
/** The one reason until Q9 (N200 answer 1). */
export const DEFAULT_LOST_REASON = 'Khác (chờ Q9)';

export interface AddedPipeline {
  readonly stages: number;
  readonly reasons: number;
}

/**
 * Gives `workspaceId` the default steps when it has none, and the default reason when it has no list, in the caller's transaction (as
 * migration_role). A workspace that has steps keeps them as they are, whoever made them: nothing is ever overwritten. The caller holds
 * the workspace's row (FOR UPDATE, or the INSERT that made it), so two runs at once cannot both add.
 */
export async function addDefaultPipeline(
  client: Queryable,
  orgId: string,
  workspaceId: string,
  newId: () => string,
): Promise<AddedPipeline> {
  const has = async (table: 'pipeline_stages' | 'pipeline_lost_reasons') =>
    ((
      await client.query(
        `SELECT 1 FROM public.${table} WHERE org_id = $1 AND workspace_id = $2 LIMIT 1`,
        [orgId, workspaceId],
      )
    ).rowCount ?? 0) > 0;
  let stages = 0;
  if (!(await has('pipeline_stages'))) {
    for (const [position, name] of DEFAULT_STAGES.entries())
      await client.query(
        'INSERT INTO public.pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, $4, $5)',
        [newId(), orgId, workspaceId, name, position],
      );
    stages = DEFAULT_STAGES.length;
  }
  let reasons = 0;
  if (!(await has('pipeline_lost_reasons'))) {
    await client.query(
      'INSERT INTO public.pipeline_lost_reasons (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, $4, 0)',
      [newId(), orgId, workspaceId, DEFAULT_LOST_REASON],
    );
    reasons = 1;
  }
  return { stages, reasons };
}
