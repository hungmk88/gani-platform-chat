import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirrors migration 202610061020_create_conversation_events.sql (partitioned by month in the database).
export const conversationEvents = pgTable(
  'conversation_events',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    eventType: text('event_type').notNull(),
    fromState: text('from_state'),
    toState: text('to_state'),
    fromHold: boolean('from_hold'),
    toHold: boolean('to_hold'),
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id'),
    versionAfter: integer('version_after').notNull(),
    outcome: text('outcome'),
    traceId: text('trace_id').notNull(),
    detail: jsonb('detail').notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.id, t.occurredAt] })],
);
