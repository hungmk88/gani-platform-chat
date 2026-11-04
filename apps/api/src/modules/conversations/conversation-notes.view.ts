import type { NoteRow } from '@gani/db';

/** A note as the API gives it (schema ConversationNote). */
export const noteView = (row: NoteRow) => ({
  id: row.id,
  conversationId: row.conversationId,
  kind: row.kind,
  author: { id: row.authorUserId, name: row.authorName },
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});
