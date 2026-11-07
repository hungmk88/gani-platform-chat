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
    // The end of a session (U79, N207 B3): both NULL while it runs.
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason', { enum: ['manual', 'expired'] }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })],
);
