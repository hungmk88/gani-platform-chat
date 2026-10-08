import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610071220_create_inbound_event_keys.sql. One row per event already received: the primary key is what stops a
// webhook sent again from becoming a second event (I1). Written with ON CONFLICT DO NOTHING in the transaction of the event.
export const inboundEventKeys = pgTable(
  'inbound_event_keys',
  {
    orgId: uuid('org_id').notNull(),
    channelAccountId: uuid('channel_account_id').notNull(),
    platformMessageId: text('platform_message_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.channelAccountId, t.platformMessageId] })],
);
