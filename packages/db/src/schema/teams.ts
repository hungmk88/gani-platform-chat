import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031400_create_teams.sql. workspaceId is NULL for a company-wide team.
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
