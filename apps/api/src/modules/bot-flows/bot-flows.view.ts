import type { BotFlowRow, BotFlowVersionRow } from '@gani/db';

/** A flow as the API answers it (BotFlowSchema). */
export const botFlowView = (row: BotFlowRow, publishedVersion: number | null) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  status: row.status,
  version: row.version,
  publishedVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** A draft or published version with its graph (BotFlowVersionSchema); a discarded one is never answered. */
export const botFlowVersionView = (row: BotFlowVersionRow) => ({
  id: row.id,
  status: row.status as 'draft' | 'published',
  version: row.version,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  graph: row.graph,
});
