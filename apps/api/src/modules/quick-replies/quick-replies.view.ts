import type { QuickReplyRow } from '@gani/db';

/** A row of quick_replies as the API answers it (QuickReplySchema). */
export const quickReplyView = (row: QuickReplyRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  shortcut: row.shortcut,
  body: row.body,
  tags: [...row.tags],
  useCount: row.useCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
