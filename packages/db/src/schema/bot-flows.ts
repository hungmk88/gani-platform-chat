import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migrations 202611031000_create_bot_flows.sql (flows and versions, D1a1a, N176) and 202611041000_create_bot_nodes.sql
// (the graph of a version, D1a1b, N177).
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

export const botNodes = pgTable('bot_nodes', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  versionId: uuid('version_id').notNull(),
  key: text('key').notNull(),
  type: text('type', {
    enum: [
      'trigger',
      'message',
      'question',
      'condition',
      'set_variable',
      'collect',
      'tag',
      'api_call',
      'delay',
      'handoff',
      'jump_to_flow',
      'end',
    ],
  }).notNull(),
  config: jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const botEdges = pgTable('bot_edges', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  versionId: uuid('version_id').notNull(),
  fromNodeId: uuid('from_node_id').notNull(),
  toNodeId: uuid('to_node_id').notNull(),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
