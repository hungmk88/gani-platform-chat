import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const platformAccessLogs = pgTable(
  'platform_access_logs',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id').notNull(),
    operatorUserId: uuid('operator_user_id').notNull(),
    dbLogin: text('db_login').notNull(),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })],
);
