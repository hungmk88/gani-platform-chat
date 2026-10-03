import { boolean, date, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031800_create_feature_flags_global.sql. Global table: no org_id, no RLS.
export const featureFlagsGlobal = pgTable('feature_flags_global', {
  key: text('key').primaryKey(),
  description: text('description').notNull(),
  owner: text('owner').notNull(),
  removeBy: date('remove_by').notNull(),
  defaultEnabled: boolean('default_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
