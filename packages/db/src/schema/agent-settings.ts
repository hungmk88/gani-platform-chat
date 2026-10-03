import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031820_create_agent_settings.sql.
export const agentSettings = pgTable('agent_settings', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  maxConcurrentConversations: integer('max_concurrent_conversations').notNull().default(5),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
