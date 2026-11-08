import {
  InvalidCursorError,
  listSecurityAlerts,
  listSecurityIncidents,
  type SecurityAlertRow,
  type SecurityIncidentRow,
  type TenantContext,
  type TenantTx,
} from '@gani/db';
import { Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import type { z } from 'zod';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { currentActorContext } from '../request-context/request-context.js';
import {
  SecurityAlertListQuerySchema,
  SecurityIncidentListQuerySchema,
} from './security.schemas.js';

/** N207 B4: an incident a platform operator opened names them by role, never by their own name; the id stays for the audit. */
export const OPERATOR_NAME = 'Nhân viên nền tảng';

const alertView = (a: SecurityAlertRow) => ({
  id: a.id,
  kind: a.kind,
  severity: a.severity,
  occurredAt: a.occurredAt.toISOString(),
  subjectUserId: a.subjectUserId,
  channelAccountId: a.channelAccountId,
  count: a.count,
  incidentId: a.incidentId,
});

/** A name that is null stays null (N215): the screen words it, the server never makes one up. */
const incidentView = (r: SecurityIncidentRow) => ({
  id: r.id,
  title: r.title,
  severity: r.severity,
  status: r.status,
  handler: { id: r.handlerUserId, name: r.handlerName },
  openedBy:
    r.openedByOperatorId === null
      ? { id: r.openedByUserId as string, name: r.openedByName }
      : { id: r.openedByOperatorId, name: OPERATOR_NAME },
  alertIds: [...r.alertIds],
  openedAt: r.openedAt.toISOString(),
  closedAt: r.closedAt?.toISOString() ?? null,
});

/**
 * Who may read P11: an Owner, an Admin, or a platform operator inside an access session of the organisation (N207, P11b-2). The first
 * module to let operators in (P11b-1 opens none): it asks currentActorContext() on purpose and opens its own transaction with the
 * organisation of the session. Every other role is 403, before anything is read.
 */
function reader(): TenantContext {
  const ctx = currentActorContext();
  if (ctx.role !== 'platform_operator' && ctx.role !== 'owner' && ctx.role !== 'admin')
    throw new ForbiddenException();
  return { orgId: ctx.orgId, workspaceIds: [] };
}

/** P11 reads (U35, N167): the alerts and incidents of the organisation of the session, newest first by cursor. */
@Controller('v1')
export class SecurityController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('security-alerts')
  async alerts(
    @Query(new ZodPipe(SecurityAlertListQuerySchema))
    q: z.infer<typeof SecurityAlertListQuerySchema>,
  ) {
    const page = await this.read(reader(), (tx) =>
      listSecurityAlerts(tx, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.severity === undefined ? {} : { severity: q.severity }),
        ...(q.open === undefined ? {} : { open: q.open === 'true' }),
      }),
    );
    return { data: page.rows.map(alertView), nextCursor: page.nextCursor };
  }

  @Get('security-incidents')
  async incidents(
    @Query(new ZodPipe(SecurityIncidentListQuerySchema))
    q: z.infer<typeof SecurityIncidentListQuerySchema>,
  ) {
    const page = await this.read(reader(), (tx) =>
      listSecurityIncidents(tx, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.status === undefined ? {} : { status: q.status }),
      }),
    );
    return { data: page.rows.map(incidentView), nextCursor: page.nextCursor };
  }

  private async read<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new ValidationFailedError(['cursor: invalid']);
      throw error;
    }
  }
}
