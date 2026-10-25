import type { TeamRow } from '@gani/db';

/** A row of teams as the API answers it (TeamSchema). */
export const teamView = (row: TeamRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  slug: row.slug,
  description: row.description,
  isDefault: row.isDefault,
  memberCount: row.memberCount,
  channelIds: [...row.channelIds],
  createdAt: row.createdAt.toISOString(),
});
