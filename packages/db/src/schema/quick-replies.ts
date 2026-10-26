import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610261000_create_quick_replies.sql: the canned answers of a workspace (C7, N163).
export const quickReplies = pgTable('quick_replies', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  shortcut: text('shortcut').notNull(),
  body: text('body').notNull(),
  tags: text('tags').array().notNull().default([]),
  useCount: integer('use_count').notNull().default(0),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
