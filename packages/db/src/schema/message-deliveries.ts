import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations 202610211000_create_message_deliveries.sql (whether a message of the account reached the person, N146) and
// 202611071000_add_message_deliveries_outbound_lease.sql (the lease and the next attempt of the outbound worker, O1, N185).
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
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
