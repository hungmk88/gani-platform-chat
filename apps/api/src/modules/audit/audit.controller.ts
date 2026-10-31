import { type AuditLogEntry, listAuditLogs, type OrgRole } from '@gani/db';
import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { AuditLogQuerySchema, type AuditLogQueryParams } from './audit.schemas.js';

/** Brief P9 "GET /v1/audit-logs": an Owner or an Admin. */
export const mayReadAuditLog = (role: OrgRole): boolean => role === 'owner' || role === 'admin';

const view = (row: AuditLogEntry) => ({ ...row, createdAt: row.createdAt.toISOString() });

/**
 * The audit log of the session's organisation (Brief P9, A9a): newest first, filtered by person, action and time. The role is checked
 * before any read; the organisation comes from the session only (rule 1), RLS keeps every other one out. `detail` may hold the reason
 * an Owner or Admin typed (N155): it is answered, never logged.
 */
@Controller('v1/audit-logs')
export class AuditController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(AuditLogQuerySchema)) q: AuditLogQueryParams) {
    const ctx = currentRequestContext();
    if (!mayReadAuditLog(ctx.role)) throw new ForbiddenException();
    const from = q.from === undefined ? undefined : new Date(q.from);
    const to = q.to === undefined ? undefined : new Date(q.to);
    if (from && to && from >= to) throw new ValidationFailedError(['from: must be before to']);
    const rows = await this.database.withTenant(ctx, (tx) =>
      listAuditLogs(tx, {
        limit: q.limit,
        ...(q.actorUserId === undefined ? {} : { actorUserId: q.actorUserId }),
        ...(q.action === undefined ? {} : { action: q.action }),
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      }),
    );
    return { data: rows.map(view) };
  }
}
