import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Mirrors migration 202611092000_create_security_incidents.sql (P11a-1, N207): the security incidents and alerts of an organisation.
export const securityIncidents = pgTable('security_incidents', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  title: text('title').notNull(),
  severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
  status: text('status', { enum: ['open', 'closed'] })
    .notNull()
    .default('open'),
  handlerUserId: uuid('handler_user_id').notNull(),
  openedByUserId: uuid('opened_by_user_id'),
  openedByOperatorId: uuid('opened_by_operator_id'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const securityAlerts = pgTable('security_alerts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  kind: text('kind', {
    enum: [
      'login_failures',
      'two_factor_locked',
      'two_factor_reset',
      'platform_access',
      'webhook_signature_invalid',
      'bulk_export',
    ],
  }).notNull(),
  severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
  subjectUserId: uuid('subject_user_id'),
  channelAccountId: uuid('channel_account_id'),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(1),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  incidentId: uuid('incident_id'),
});
