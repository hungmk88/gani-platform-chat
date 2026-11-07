import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirror migration 202610271000_create_customers.sql: the customers of an organisation and the identities a channel knows them by (CRM
// J1/J2, N165).
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  displayName: text('display_name'),
  phoneE164: text('phone_e164'),
  email: text('email'),
  humanOnly: boolean('human_only').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** The customer this one was merged into (J3, migration 202611091900); hidden from the lists while it is set. */
  mergedInto: uuid('merged_into'),
  mergedAt: timestamp('merged_at', { withTimezone: true }),
});

export const customerIdentities = pgTable('customer_identities', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  identityType: text('identity_type', { enum: ['zalo_uid'] }).notNull(),
  channelAccountId: uuid('channel_account_id'),
  externalId: text('external_id').notNull(),
  verification: text('verification', { enum: ['verified', 'unverified', 'sales_confirmed'] })
    .notNull()
    .default('unverified'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The tables a merge moves rows of (customer_merge_moves.table_name); the store maps each to its table through this list only. */
export const MERGE_MOVE_TABLES = [
  'conversations',
  'customer_identities',
  'tickets',
  'leads',
  'customer_tags',
  'customer_field_values',
] as const;
export type MergeMoveTable = (typeof MERGE_MOVE_TABLES)[number];

/** One merge of a source customer into a target (J3, N204); undone when unmerged_at is set. */
export const customerMerges = pgTable('customer_merges', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  sourceId: uuid('source_id').notNull(),
  targetId: uuid('target_id').notNull(),
  mergedBy: uuid('merged_by').notNull(),
  mergedAt: timestamp('merged_at', { withTimezone: true }).notNull().defaultNow(),
  filledFields: text('filled_fields', { enum: ['display_name', 'phone_e164', 'email'] })
    .array()
    .notNull()
    .default([]),
  unmergedBy: uuid('unmerged_by'),
  unmergedAt: timestamp('unmerged_at', { withTimezone: true }),
});

/** A row a merge moved to the target, by table and id, so the unmerge gives back exactly it. */
export const customerMergeMoves = pgTable('customer_merge_moves', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  mergeId: uuid('merge_id').notNull(),
  tableName: text('table_name', { enum: MERGE_MOVE_TABLES }).notNull(),
  rowId: uuid('row_id').notNull(),
});
