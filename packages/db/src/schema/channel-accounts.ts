import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from './bytea.js';

// Mirrors migration 202610071000_create_channel_accounts.sql. The columns ending in `Enc` hold ciphertext made by SecretBox
// (nonce(12) || tag(16) || ciphertext): the database cannot tell it from plain text, so nothing writes a plain value here.
// orgId, workspaceId, type, externalAccountId, appId and createdBy never change after creation (column-level UPDATE).
export const channelAccounts = pgTable('channel_accounts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  type: text('type').notNull(),
  externalAccountId: text('external_account_id').notNull(),
  displayName: text('display_name').notNull(),
  appId: text('app_id'),
  appSecretEnc: bytea('app_secret_enc'),
  oaSecretKeyEnc: bytea('oa_secret_key_enc'),
  accessTokenEnc: bytea('access_token_enc'),
  refreshTokenEnc: bytea('refresh_token_enc'),
  keyVersion: integer('key_version').notNull().default(1),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  refreshClaimedAt: timestamp('refresh_claimed_at', { withTimezone: true }),
  status: text('status').notNull().default('disconnected'),
  lastError: text('last_error'),
  /** The team that answers the channel (N161); none: the default team of the workspace. */
  teamId: uuid('team_id'),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
