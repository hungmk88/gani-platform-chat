import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610071210_create_inbound_events.sql (partitioned by month in the database). payload holds the content of
// customers: it is never logged and support_role cannot read it. orgId, workspaceId, channelAccountId, platformMessageId, eventType,
// payload and receivedAt never change after the insert (column-level UPDATE); lastError is a code, never a message.
export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    channelAccountId: uuid('channel_account_id').notNull(),
    platformMessageId: text('platform_message_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [primaryKey({ columns: [t.id, t.receivedAt] })],
);
