import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031200_create_users.sql. Global, no RLS; app_role has no privilege on it (spec §3.3).
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  locale: text('locale'),
  status: text('status', { enum: ['pending_password', 'active'] }).notNull(),
  pendingPasswordSince: timestamp('pending_password_since', { withTimezone: true }),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  isPlatformOperator: boolean('is_platform_operator').notNull().default(false),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
