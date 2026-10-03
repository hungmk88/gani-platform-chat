import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031410_create_team_members.sql.
export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  teamId: uuid('team_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
