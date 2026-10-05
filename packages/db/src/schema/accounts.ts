import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610032010_create_accounts.sql. password is an Argon2id hash (a CHECK enforces the prefix).
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
