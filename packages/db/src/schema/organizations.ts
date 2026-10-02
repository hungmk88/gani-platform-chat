import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031100_create_organizations.sql (checked against the real table in tests).
// `id` is the tenant key itself (spec RLS M01 §4.1) and is a UUIDv7 made by the application.
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
