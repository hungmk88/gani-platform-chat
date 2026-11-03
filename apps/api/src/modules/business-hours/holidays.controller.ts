import {
  createDayOff,
  deleteDayOff,
  insertAuditLog,
  listDaysOff,
  lockDayOff,
  lockWorkspace,
  readWorkingWeek,
  updateDayOff,
  type TenantTx,
} from '@gani/db';
import { localTime, uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { WorkspaceIdParamSchema } from './business-hours.schemas.js';
import {
  holidayHttpErrorOf,
  HolidayInPastHttpError,
  HolidayOverlapHttpError,
} from './holidays.errors.js';
import {
  HolidayChangeSchema,
  HolidayCreateSchema,
  HolidayIdSchema,
  HolidayListQuerySchema,
  type HolidayChange,
} from './holidays.schemas.js';

/**
 * The days off of a workspace (C10-3b, N192, U44): an Owner or an Admin only (CEO 02/11/2026). A day off that overlaps another is 422
 * holiday_overlap; one that is over (ends before today, workspace time) is 422 holiday_in_past, to add, to change and to remove alike,
 * so the history SLA reads stays (C8). Every change is audited; a refused one too (`workspace.holiday_rejected`), in a transaction of
 * its own once the refused one rolled back.
 */
@Controller('v1/workspaces/:id/holidays')
export class HolidaysController {
  private readonly logger = new Logger(HolidaysController.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(
    @Param('id', new ZodPipe(WorkspaceIdParamSchema)) id: string,
    @Query(new ZodPipe(HolidayListQuerySchema)) q: { from?: string },
  ) {
    const rows = await this.database.withTenant(owners(), async (tx) => {
      const week = await readWorkingWeek(tx, id);
      if (!week) throw new NotFoundException();
      return listDaysOff(tx, id, q.from ?? localTime(new Date(), week.timezone).date);
    });
    return { data: rows };
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(
    @Param('id', new ZodPipe(WorkspaceIdParamSchema)) id: string,
    @Body(new ZodPipe(HolidayCreateSchema))
    body: { name: string; startsOn: string; endsOn: string },
  ) {
    return this.write(id, 'workspace.holiday_added', async (tx) => {
      await this.workspace(tx, id);
      return createDayOff(tx, { id: uuidv7(), workspaceId: id, ...body });
    });
  }

  @Patch(':hid')
  async change(
    @Param('id', new ZodPipe(WorkspaceIdParamSchema)) id: string,
    @Param('hid', new ZodPipe(HolidayIdSchema)) hid: string,
    @Body(new ZodPipe(HolidayChangeSchema)) body: HolidayChange,
  ) {
    return this.write(id, 'workspace.holiday_changed', async (tx) => {
      const current = await this.current(tx, id, hid);
      const [startsOn, endsOn] = [body.startsOn ?? current.startsOn, body.endsOn ?? current.endsOn];
      if (startsOn > endsOn) throw new ValidationFailedError(['startsOn: after endsOn']);
      return updateDayOff(tx, id, current, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.startsOn === undefined ? {} : { startsOn: body.startsOn }),
        ...(body.endsOn === undefined ? {} : { endsOn: body.endsOn }),
      });
    });
  }

  @Delete(':hid')
  @HttpCode(204)
  async remove(
    @Param('id', new ZodPipe(WorkspaceIdParamSchema)) id: string,
    @Param('hid', new ZodPipe(HolidayIdSchema)) hid: string,
  ) {
    await this.write(id, 'workspace.holiday_removed', async (tx) => {
      const current = await this.current(tx, id, hid);
      await deleteDayOff(tx, hid);
      return current;
    });
  }

  /** The workspace, locked (every write of its days off queues on it); 404 when it is not of the organisation. */
  private async workspace(tx: TenantTx, id: string) {
    const ws = await lockWorkspace(tx, id);
    if (!ws) throw new NotFoundException();
    return ws;
  }

  /** The live day off `hid` of the workspace, locked; 404 when there is none, 422 holiday_in_past when it is over. */
  private async current(tx: TenantTx, id: string, hid: string) {
    const ws = await this.workspace(tx, id);
    const row = await lockDayOff(tx, id, hid);
    if (!row) throw new NotFoundException();
    if (row.endsOn < localTime(new Date(), ws.timezone).date) throw new HolidayInPastHttpError();
    return row;
  }

  /** One write and its audit row; a 422 of the rules is audited too, after its transaction rolled back. */
  private async write<T extends { id: string; startsOn: string; endsOn: string }>(
    workspaceId: string,
    action: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    const ctx = owners();
    try {
      return await this.database.withTenant(ctx, async (tx) => {
        const row = await fn(tx);
        await this.audit(tx, ctx, workspaceId, action, {
          holidayId: row.id,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
        });
        return row;
      });
    } catch (error) {
      const http = holidayHttpErrorOf(error);
      if (http instanceof HolidayOverlapHttpError || http instanceof HolidayInPastHttpError)
        await this.database
          .withTenant(ctx, (tx) =>
            this.audit(tx, ctx, workspaceId, 'workspace.holiday_rejected', { code: http.code }),
          )
          .catch((e: unknown) =>
            this.logger.warn(
              `holiday rejection audit failed (${e instanceof Error ? e.name : 'unknown'})`,
            ),
          );
      throw http;
    }
  }

  private audit(
    tx: TenantTx,
    ctx: RequestContext,
    workspaceId: string,
    action: string,
    detail: Readonly<Record<string, string>>,
  ) {
    return insertAuditLog(tx, {
      id: uuidv7(),
      actorUserId: ctx.userId,
      action,
      targetType: 'workspace',
      targetId: workspaceId,
      detail,
    });
  }
}

/** The request context of an Owner or an Admin; 403 for any other role. */
function owners() {
  const ctx = currentRequestContext();
  if (!mayInvite(ctx.role)) throw new ForbiddenException();
  return ctx;
}
