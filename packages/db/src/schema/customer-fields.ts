import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirror migration 202611091100_create_customer_fields.sql: the custom fields of a company's customers and their values (J1, T-5, N191).
// A field ends with deleted_at; a value is cleared by setting it to NULL, never a DELETE (spec RLS M01 §7 case 11).
export const customerFieldDefs = pgTable('customer_field_defs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  options: text('options').array().notNull().default([]),
  required: boolean('required').notNull().default(false),
  sensitive: boolean('sensitive').notNull().default(false),
  hidden: boolean('hidden').notNull().default(false),
  position: integer('position').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customerFieldValues = pgTable('customer_field_values', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  fieldId: uuid('field_id').notNull(),
  value: jsonb('value'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
