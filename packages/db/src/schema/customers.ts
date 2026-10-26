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
