import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610032000_create_sessions.sql. Global, no RLS; only auth_role has any privilege (spec §3.2).
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  activeOrgId: uuid('active_org_id'),
  // Always empty: kept only because Better Auth writes both on every session (a CHECK allows NULL or '').
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
