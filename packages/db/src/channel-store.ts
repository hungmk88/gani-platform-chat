import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { channelAccounts } from './schema/channel-accounts.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The channel accounts of a workspace as /settings/teams sees them, and the team that answers each one (A4, N161). Only metadata: the
// columns ending in _enc are never read here. Row-level security keeps them to the transaction's organisation; who may read or change
// them is the caller's check.

export interface ChannelRow {
  readonly id: string;
  readonly type: string;
  readonly displayName: string;
  readonly status: string;
  /** The team that answers the channel; null: the default team of the workspace. */
  readonly teamId: string | null;
}

const columns = {
  id: channelAccounts.id,
  type: channelAccounts.type,
  displayName: channelAccounts.displayName,
  status: channelAccounts.status,
  teamId: channelAccounts.teamId,
};

/** The live channel accounts of a workspace, by name. */
export async function listChannels(tx: TenantTx, workspaceId: string): Promise<ChannelRow[]> {
  return tx
    .select(columns)
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.workspaceId, assertUuid(workspaceId, 'workspaceId')),
        isNull(channelAccounts.deletedAt),
      ),
    )
    .orderBy(asc(channelAccounts.displayName), asc(channelAccounts.id))
    .limit(200);
}

/**
 * Makes `channelIds`, live channel accounts of the team's workspace, the channels the team answers: the others it answers now go back
 * to the default team, and a channel of another team moves to this one. The workspace and the team are locked by the caller first
 * (lockWorkspace, then lockTeam), and the channels of the workspace here, always in that order. Returns null, changing nothing, when an
 * id is not a live channel of the workspace; otherwise how many came, left, and came from another team.
 */
export async function setTeamChannels(
  tx: TenantTx,
  q: {
    readonly teamId: string;
    readonly workspaceId: string;
    readonly channelIds: readonly string[];
  },
): Promise<{ added: number; removed: number; moved: number } | null> {
  const teamId = assertUuid(q.teamId, 'teamId');
  const wanted = new Set(q.channelIds.map((id) => assertUuid(id, 'channelId')));
  const now = new Map(
    (
      await tx
        .select({ id: channelAccounts.id, teamId: channelAccounts.teamId })
        .from(channelAccounts)
        .where(
          and(
            eq(channelAccounts.workspaceId, assertUuid(q.workspaceId, 'workspaceId')),
            isNull(channelAccounts.deletedAt),
          ),
        )
        .for('update')
    ).map((r) => [r.id, r.teamId]),
  );
  if ([...wanted].some((id) => !now.has(id))) return null;
  const leave = [...now]
    .filter(([id, team]) => team === teamId && !wanted.has(id))
    .map(([id]) => id);
  const come = [...wanted].filter((id) => now.get(id) !== teamId);
  const moved = come.filter((id) => now.get(id) !== null).length;
  for (const [ids, team] of [
    [leave, null],
    [come, teamId],
  ] as const)
    if (ids.length > 0)
      await tx
        .update(channelAccounts)
        .set({ teamId: team, updatedAt: sql`now()` })
        .where(inArray(channelAccounts.id, ids));
  return { added: come.length, removed: leave.length, moved };
}
