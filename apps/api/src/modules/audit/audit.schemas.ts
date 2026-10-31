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
  .object({
    data: z.array(AuditLogSchema),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'The next page, with the same filters; null: no more.' }),
  })
  .meta({ id: 'AuditLogList' });

/**
 * `GET /v1/audit-logs?actorUserId=&action=&targetType=&from=&to=&limit=&cursor=` (A9a, A9b): newest first, `limit` a page (100 at most,
 * as `AUDIT_LOG_MAX_LIMIT` of @gani/db). The organisation is the session's and never a parameter (rule 1): an unknown one is refused.
 */
export const AuditLogQuerySchema = z
  .object({
    actorUserId: UuidSchema.optional(),
    action: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
      .optional(),
    targetType: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional()
      .meta({ description: 'member, workspace, team, customer…' }),
    from: z.iso.datetime({ offset: true }).optional().meta({ description: 'Included.' }),
    to: z.iso
      .datetime({ offset: true })
      .optional()
      .meta({ description: 'Left out; after `from`.' }),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type AuditLogQueryParams = z.infer<typeof AuditLogQuerySchema>;
