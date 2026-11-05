import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611091800_create_leads.sql: the leads of a workspace and what happened to them (G1–G3, N188, N196, N200).
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  title: text('title').notNull(),
  customerId: uuid('customer_id').notNull(),
  conversationId: uuid('conversation_id'),
  stageId: uuid('stage_id').notNull(),
  status: text('status', { enum: ['open', 'won', 'lost'] })
    .notNull()
    .default('open'),
  ownerUserId: uuid('owner_user_id'),
  createdBy: uuid('created_by').notNull(),
  lostReason: text('lost_reason'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leadEvents = pgTable('lead_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  leadId: uuid('lead_id').notNull(),
  type: text('type', { enum: ['created', 'stage_changed', 'owner_changed', 'closed'] }).notNull(),
  fromStageId: uuid('from_stage_id'),
  toStageId: uuid('to_stage_id'),
  outcome: text('outcome', { enum: ['won', 'lost'] }),
  actorUserId: uuid('actor_user_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
