import { sql } from 'drizzle-orm';

import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The people who may receive a conversation of a workspace (U31): the "Chuyển" and "Gán lại" dialogs list them, so the rule must be the
// one the API applies when it hands a conversation over (handOver, apps/api conversation-actions): an active member of the organisation
// who is a member of the live workspace and, for a Sales/Support transfer, shares a team with the caller. Which roles may hold a
// conversation and who holds it now are the caller's checks. Names come through app.org_users (active members, no email), never from
// users; the counts through app.held_conversation_counts, for the whole organisation (N168).

export interface AssigneeCandidate {
  readonly userId: string;
  readonly name: string | null;
  readonly role: string;
  /** The team of the person in this workspace: one shared with the viewer first, then by name. Null when in none. */
  readonly teamId: string | null;
  readonly teamName: string | null;
  /** Conversations the person holds in every live workspace of the organisation. */
  readonly openCount: number;
  /** Their own limit (agent_settings), else the default of this workspace. */
  readonly maxConcurrent: number;
}

type Row = {
  readonly user_id: string;
  readonly name: string | null;
  readonly role: string;
  readonly team_id: string | null;
  readonly team_name: string | null;
  readonly open_count: number;
  readonly max_concurrent: number;
};

/**
 * The active members of a live workspace, by name (no name last). With `teammatesOnly`, only those who share a live team membership
 * with `viewerId`, as shareTeam reads it (any team of the organisation).
 */
export async function listAssigneeCandidates(
  tx: TenantTx,
  q: { readonly workspaceId: string; readonly viewerId: string; readonly teammatesOnly?: boolean },
): Promise<AssigneeCandidate[]> {
  const ws = assertUuid(q.workspaceId, 'workspaceId');
  const viewer = assertUuid(q.viewerId, 'viewerId');
  const teammates = q.teammatesOnly
    ? sql`AND EXISTS (SELECT 1 FROM public.team_members mine
        JOIN public.team_members theirs ON theirs.org_id = mine.org_id AND theirs.team_id = mine.team_id
        WHERE mine.user_id = ${viewer}::uuid AND theirs.user_id = u.user_id
          AND mine.deleted_at IS NULL AND theirs.deleted_at IS NULL)`
    : sql``;
  const { rows } = await tx.execute<Row>(sql`
    WITH people AS (
      SELECT u.org_id, u.user_id, nullif(btrim(u.display_name), '') AS name, u.role, w.default_max_concurrent
      FROM app.org_users u
      JOIN public.workspace_members wm ON wm.org_id = u.org_id AND wm.user_id = u.user_id
        AND wm.workspace_id = ${ws}::uuid AND wm.deleted_at IS NULL
      JOIN public.workspaces w ON w.org_id = wm.org_id AND w.id = wm.workspace_id AND w.deleted_at IS NULL
      WHERE true ${teammates}
    )
    SELECT p.user_id, p.name, p.role, t.id AS team_id, t.name AS team_name,
      coalesce(h.held, 0)::int AS open_count,
      coalesce(a.max_concurrent_conversations, p.default_max_concurrent) AS max_concurrent
    FROM people p
    LEFT JOIN public.agent_settings a ON a.org_id = p.org_id AND a.user_id = p.user_id
    LEFT JOIN LATERAL (
      SELECT tt.id, tt.name FROM public.team_members tm
      JOIN public.teams tt ON tt.org_id = tm.org_id AND tt.id = tm.team_id
      WHERE tm.org_id = p.org_id AND tm.user_id = p.user_id AND tm.deleted_at IS NULL
        AND tt.workspace_id = ${ws}::uuid AND tt.deleted_at IS NULL
      ORDER BY EXISTS (SELECT 1 FROM public.team_members v WHERE v.org_id = tm.org_id AND v.team_id = tm.team_id
          AND v.user_id = ${viewer}::uuid AND v.deleted_at IS NULL) DESC, tt.name, tt.id
      LIMIT 1
    ) t ON true
    LEFT JOIN app.held_conversation_counts(ARRAY(SELECT user_id FROM people)) h ON h.user_id = p.user_id
    ORDER BY p.name NULLS LAST, p.user_id`);
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    role: r.role,
    teamId: r.team_id,
    teamName: r.team_name,
    openCount: r.open_count,
    maxConcurrent: r.max_concurrent,
  }));
}
