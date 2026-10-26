import { z } from 'zod';

import {
  CursorQuerySchema,
  cursorPage,
  NullableUuidSchema,
  UuidSchema,
} from '../../openapi/schemas.js';

// P11, security alerts and incidents (#29; U35, CEO 26/10/2026; Brief P9 "/v1/security-alerts", "/v1/security-incidents"). A list of
// alerts and an "open an incident" button (title, severity, handler); an incident is open or closed, no workflow of several steps.

const at = z.iso.datetime();

/** Four levels (N167). */
export const SECURITY_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/**
 * What raises an alert (N167): many failed sign-ins, an account locked by the second factor, a second factor reset by an admin, a
 * platform operator's access session, webhooks with a bad signature, a large export of data.
 */
export const SECURITY_ALERT_KINDS = [
  'login_failures',
  'two_factor_locked',
  'two_factor_reset',
  'platform_access',
  'webhook_signature_invalid',
  'bulk_export',
] as const;

export const SecurityAlertSchema = z
  .object({
    id: UuidSchema,
    kind: z.enum(SECURITY_ALERT_KINDS),
    severity: z.enum(SECURITY_SEVERITIES),
    occurredAt: at,
    /** Who or what it is about, as ids: the member, the channel account. Never an email, a phone or an address. */
    subjectUserId: NullableUuidSchema,
    channelAccountId: NullableUuidSchema,
    /** How many times it happened in its window (failed sign-ins in 15 minutes, bad signatures in an hour). */
    count: z.int().min(1),
    /** The incident opened from it, if any. */
    incidentId: NullableUuidSchema,
  })
  .meta({ id: 'SecurityAlert' });

export const SecurityAlertPageSchema = cursorPage(SecurityAlertSchema, 'SecurityAlertPage');
export const SecurityAlertListQuerySchema = CursorQuerySchema.extend({
  severity: z.enum(SECURITY_SEVERITIES).optional(),
  /** `true`: only alerts no incident covers yet. */
  open: z.enum(['true', 'false']).optional(),
});

const named = z.object({ id: UuidSchema, name: z.string() });

export const SecurityIncidentSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    severity: z.enum(SECURITY_SEVERITIES),
    status: z.enum(['open', 'closed']),
    handler: named,
    openedBy: named,
    alertIds: z.array(UuidSchema),
    openedAt: at,
    closedAt: at.nullable(),
  })
  .meta({ id: 'SecurityIncident' });

export const SecurityIncidentPageSchema = cursorPage(
  SecurityIncidentSchema,
  'SecurityIncidentPage',
);
export const SecurityIncidentListQuerySchema = CursorQuerySchema.extend({
  status: z.enum(['open', 'closed']).optional(),
});

export const SecurityIncidentCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    severity: z.enum(SECURITY_SEVERITIES),
    /** A member of the organisation who is an Owner or an Admin. */
    handlerUserId: UuidSchema,
    alertIds: z.array(UuidSchema).max(50).optional(),
  })
  .strict()
  .meta({ id: 'SecurityIncidentCreate' });

export const SecurityIncidentChangeSchema = z
  .object({ status: z.literal('closed').optional(), handlerUserId: UuidSchema.optional() })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'SecurityIncidentChange' });

export const SecurityIncidentIdSchema = UuidSchema;
