import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610211000_create_message_deliveries.sql: whether a message of the account reached the person (N146).
export const messageDeliveries = pgTable('message_deliveries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  messageId: uuid('message_id').notNull(),
  channelAccountId: uuid('channel_account_id').notNull(),
  status: text('status', { enum: ['pending', 'sent', 'failed'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  platformMessageId: text('platform_message_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
