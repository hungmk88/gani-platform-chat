import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirror migration 202611091000_create_tags.sql: the tags of an organisation and the tags each customer has (J4, T-4, N190). Both end
// with deleted_at, never a DELETE (spec RLS M01 §7 case 11).
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  hidden: boolean('hidden').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerTags = pgTable('customer_tags', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
