import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611091700_create_pipeline_stages.sql: the steps of a workspace's pipeline and its reasons to lose a lead (N196,
// N200). Written by the platform operator's commands only; app_role reads them.
export const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A list is never edited: the one in force is the rows of the latest `effectiveFrom` not in the future. */
export const pipelineLostReasons = pgTable('pipeline_lost_reasons', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
