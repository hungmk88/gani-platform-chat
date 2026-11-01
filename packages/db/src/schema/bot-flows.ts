import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611031000_create_bot_flows.sql: the scripted bot flows of a workspace and their versions (D1a1a, N176).
export const botFlows = pgTable('bot_flows', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['draft', 'active', 'inactive'] })
    .notNull()
    .default('draft'),
  version: integer('version').notNull().default(0),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const botFlowVersions = pgTable('bot_flow_versions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  flowId: uuid('flow_id').notNull(),
  status: text('status', { enum: ['draft', 'published', 'discarded'] })
    .notNull()
    .default('draft'),
  version: integer('version'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
