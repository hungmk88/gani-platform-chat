import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202610031810_create_feature_flags_overrides.sql. workspaceId is NULL for an organisation-wide override.
export const featureFlagsOverrides = pgTable('feature_flags_overrides', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workspaceId: uuid('workspace_id'),
  flagKey: text('flag_key').notNull(),
  enabled: boolean('enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
