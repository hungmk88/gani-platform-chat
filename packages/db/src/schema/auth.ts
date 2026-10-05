import { boolean, customType, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { accounts } from './accounts.js';
import { sessions } from './sessions.js';
import { twoFactors } from './two-factors.js';
import { verifications } from './verifications.js';

// What the Drizzle adapter of Better Auth sees (ADR-003, N79). It lists the columns it can read, so `users` is described here again
// and not imported from ./users.js: only the columns auth_role may SELECT (migration 202610032040), never pending_password_since.
// The property names are the field names Better Auth uses (`name`, `emailVerified`), the column names stay ours.

/** Better Auth models "email verified" as a boolean; the column is the moment it happened (email_verified_at). */
const verifiedAt = customType<{ data: boolean; driverData: Date | string | null }>({
  dataType: () => 'timestamp with time zone',
  fromDriver: (value) => value !== null,
  // Better Auth never writes it here (users come from app.accept_invite); the trigger stamps `true` with the server clock.
  toDriver: (value) => (value ? new Date() : null),
});

export const authUsers = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('display_name'),
  email: text('email').notNull(),
  emailVerified: verifiedAt('email_verified_at'),
  status: text('status', { enum: ['pending_password', 'active'] }).notNull(),
  isPlatformOperator: boolean('is_platform_operator').notNull(),
  twoFactorEnabled: boolean('two_factor_enabled').notNull(),
  failedLoginCount: integer('failed_login_count').notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** The `schema` option of Better Auth's drizzleAdapter, used with `usePlural: true` (model `twoFactor` -> `twoFactors`). */
export const authSchema = {
  users: authUsers,
  sessions,
  accounts,
  verifications,
  twoFactors,
} as const;
