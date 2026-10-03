import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from './bytea.js';

// Mirrors migration 202610031500_create_api_keys.sql. `keyHash` = SHA-256 of the key (32 bytes); the key is never stored.
// workspaceId is NULL for a company-wide key.
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id'),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull().unique(),
  keyHash: bytea('key_hash').notNull().unique(),
  scopes: text('scopes').array().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
