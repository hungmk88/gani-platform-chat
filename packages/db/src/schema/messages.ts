import { bigint, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610061010_create_messages.sql (partitioned by month in the database; Drizzle does not model partitions).
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    // Allocated by the application in the transaction of the INSERT; JavaScript numbers are exact far beyond any conversation length.
    sequenceNumber: bigint('sequence_number', { mode: 'number' }).notNull(),
    senderKind: text('sender_kind').notNull(),
    senderUserId: uuid('sender_user_id'),
    kind: text('kind').notNull(),
    body: text('body'),
    platformMessageId: text('platform_message_id'),
    platformSentAt: timestamp('platform_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })],
);
