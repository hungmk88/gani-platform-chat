import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611051000_create_bot_sessions.sql: the run of a published flow version in a conversation and its steps (D1b1a,
// N183). bot_session_steps is partitioned by month; its payload holds an edge's label and a variable's name only.
export const botSessions = pgTable('bot_sessions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  versionId: uuid('version_id').notNull(),
  status: text('status', { enum: ['active', 'completed', 'handed_off', 'abandoned'] })
    .notNull()
    .default('active'),
  currentNodeKey: text('current_node_key'),
  awaiting: jsonb('awaiting'),
  vars: jsonb('vars').notNull().default({}),
  recentSteps: jsonb('recent_steps').notNull().default([]),
  stepCount: integer('step_count').notNull().default(0),
  version: integer('version').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const botSessionSteps = pgTable(
  'bot_session_steps',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    nodeKey: text('node_key').notNull(),
    nodeType: text('node_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.occurredAt] })],
);
