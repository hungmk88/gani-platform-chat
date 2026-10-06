import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610061200_create_outbox_events.sql (partitioned by month in the database).
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    workspaceId: uuid('workspace_id'),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull().default(1),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version'),
    payload: jsonb('payload').notNull().default({}),
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id'),
    traceId: text('trace_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })],
);
