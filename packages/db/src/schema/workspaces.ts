import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031300_create_workspaces.sql.
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  template: text('template', { enum: ['b2b_sales', 'b2c_order', 'service'] }).notNull(),
  timezone: text('timezone').notNull().default('Asia/Ho_Chi_Minh'),
  defaultMaxConcurrent: integer('default_max_concurrent').notNull().default(5),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
