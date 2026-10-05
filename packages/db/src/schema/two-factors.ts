import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610032030_create_two_factors.sql. One row per person.
export const twoFactors = pgTable('two_factors', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().unique(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  // false until the first correct TOTP code; an unconfirmed enrolment is not a second factor.
  verified: boolean('verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
