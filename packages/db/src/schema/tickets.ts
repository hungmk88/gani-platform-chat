import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611081000_create_tickets.sql: the tickets of a workspace and what happened to them (U27, N167, N170).
export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('new'),
  priority: text('priority').notNull().default('normal'),
  type: text('type'),
  customerId: uuid('customer_id'),
  conversationId: uuid('conversation_id'),
  assigneeUserId: uuid('assignee_user_id'),
  createdBy: uuid('created_by').notNull(),
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
  slaPausedReason: text('sla_paused_reason'),
  version: integer('version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ticketEvents = pgTable('ticket_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  type: text('type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  actorUserId: uuid('actor_user_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});
