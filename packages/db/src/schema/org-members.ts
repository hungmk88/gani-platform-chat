import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from './bytea.js';

// Mirrors migration 202610031210_create_org_members.sql. `inviteTokenHash` = SHA-256 of the token (32 bytes).
export const orgMembers = pgTable('org_members', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id'),
  invitedEmail: text('invited_email'),
  role: text('role', {
    enum: ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'],
  }).notNull(),
  status: text('status', { enum: ['pending', 'active', 'suspended'] }).notNull(),
  inviteTokenHash: bytea('invite_token_hash'),
  inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
  invitedBy: uuid('invited_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The seven roles of a member of an organisation: the one definition, read by the API from `@gani/db`. */
export type OrgRole = (typeof orgMembers.$inferSelect)['role'];
