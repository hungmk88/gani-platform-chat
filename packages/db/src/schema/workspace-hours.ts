import { date, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirror migration 202611091200_create_workspace_hours.sql: the working week of a workspace (one row per ISO weekday, a closed day
// without hours) and its days off (C10, Q7, U44, N192). A day off ends with deleted_at, never a DELETE (spec RLS M01 §7 case 11).
export const workspaceHours = pgTable('workspace_hours', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  weekday: smallint('weekday').notNull(),
  opensAt: time('opens_at'),
  closesAt: time('closes_at'),
  breakStartsAt: time('break_starts_at'),
  breakEndsAt: time('break_ends_at'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceHolidays = pgTable('workspace_holidays', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
