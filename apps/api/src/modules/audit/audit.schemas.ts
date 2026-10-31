import { z } from 'zod';

import { NullableUuidSchema, UuidSchema } from '../../openapi/schemas.js';

/** One row of the organisation's audit log (Brief P9, A9a). */
export const AuditLogSchema = z
  .object({
    id: UuidSchema,
    actorUserId: NullableUuidSchema.meta({ description: 'Who acted; null: the system.' }),
    action: z
      .string()
      .meta({ description: 'What was done, `<thing>.<verb>`: member.role_changed.' }),
    targetType: z.string().nullable(),
    targetId: NullableUuidSchema,
    detail: z.record(z.string(), z.unknown()).meta({
      description:
        'Ids and numbers of the action; for member.two_factor_reset the reason typed (N155), for this screen only.',
    }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AuditLog' });
export const AuditLogListSchema = z
  .object({ data: z.array(AuditLogSchema) })
  .meta({ id: 'AuditLogList' });

/**
 * `GET /v1/audit-logs?actorUserId=&action=&from=&to=&limit=` (A9a): newest first, at most `limit` (100, as `AUDIT_LOG_MAX_LIMIT` of
 * @gani/db), no cursor yet (A9b). The organisation is the session's and never a parameter (rule 1): an unknown one is refused.
 */
export const AuditLogQuerySchema = z
  .object({
    actorUserId: UuidSchema.optional(),
    action: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
      .optional(),
    from: z.iso.datetime({ offset: true }).optional().meta({ description: 'Included.' }),
    to: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Left out; after `from`.' }),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AuditLogQueryParams = z.infer<typeof AuditLogQuerySchema>;
