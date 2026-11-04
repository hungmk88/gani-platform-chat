import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611091600_create_conversation_notes.sql: the internal notes of a conversation (C6, N194). Append only.
export const conversationNotes = pgTable('conversation_notes', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  kind: text('kind', { enum: ['note', 'transfer_reason'] })
    .notNull()
    .default('note'),
  authorUserId: uuid('author_user_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
