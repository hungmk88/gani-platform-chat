import { boolean, date, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610071100_create_channel_policies.sql. Global table: no org_id, no RLS. The application only reads it;
// a policy changes by a migration that adds a row with a new effectiveFrom.
export const channelPolicies = pgTable('channel_policies', {
  id: uuid('id').primaryKey(),
  channelType: text('channel_type').notNull(),
  messageClass: text('message_class').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  freeWindowSeconds: integer('free_window_seconds'),
  freeMessageQuota: integer('free_message_quota'),
  unitPriceVnd: integer('unit_price_vnd'),
  outsideWindowAllowed: boolean('outside_window_allowed').notNull(),
  sourceUrl: text('source_url'),
  sourceDate: date('source_date'),
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
