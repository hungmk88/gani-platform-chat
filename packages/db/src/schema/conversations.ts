import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations 202610031830_create_conversations.sql, 202610061100_add_conversations_fsm_columns.sql and
// 202610071310_add_conversations_channel_columns.sql.
// state, version, assignedUserId, afterHoursHold, closedAt and outcome belong to the ConversationStateMachine (a trigger refuses
// any other writer, 202610061110); the rest is written by the message flow.
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(0),
  assignedUserId: uuid('assigned_user_id'),
  afterHoursHold: boolean('after_hours_hold').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  outcome: text('outcome'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  // Channel of the conversation (202610071310): both or neither. lastCustomerMessageAt is the last message of the customer.
  channelAccountId: uuid('channel_account_id'),
  externalUserId: text('external_user_id'),
  lastCustomerMessageAt: timestamp('last_customer_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
