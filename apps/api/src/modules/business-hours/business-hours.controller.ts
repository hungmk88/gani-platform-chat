import { insertAuditLog, lockWorkspace, readWorkingWeek, setWorkingWeek } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext } from '../request-context/request-context.js';
import {
  BusinessHoursChangeSchema,
  WorkspaceIdParamSchema,
  type BusinessDay,
} from './business-hours.schemas.js';
import { changedWeekdays, daysOf, weekOf } from './business-hours.view.js';

/**
 * The working week of a workspace (C10-3a, N192), for /settings/workspace: an Owner or an Admin only, as the workspace itself (N157,
 * CEO 02/11/2026). A workspace of another organisation is a 404, as row-level security hides it. The worker reads the week through
 * the store, not here.
 */
@Controller('v1/workspaces/:id/business-hours')
export class BusinessHoursController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async read(@Param('id', new ZodPipe(WorkspaceIdParamSchema)) id: string) {
    const ctx = owners();
    const hours = await this.database.withTenant(ctx, (tx) => readWorkingWeek(tx, id));
    if (!hours) throw new NotFoundException();
    return { timezone: hours.timezone, isDefault: hours.isDefault, week: daysOf(hours.week) };
  }

  /** Replaces the whole week; audited `workspace.hours_changed` with the weekdays that changed, none when nothing did. */
  @Put()
  async set(
    @Param('id', new ZodPipe(WorkspaceIdParamSchema)) id: string,
    @Body(new ZodPipe(BusinessHoursChangeSchema)) body: { week: BusinessDay[] },
  ) {
    const ctx = owners();
    const hours = await this.database.withTenant(ctx, async (tx) => {
      if (!(await lockWorkspace(tx, id))) return null;
      const before = (await readWorkingWeek(tx, id))!;
      await setWorkingWeek(tx, id, weekOf(body.week));
      const after = (await readWorkingWeek(tx, id))!;
      const weekdays = changedWeekdays(before.week, after.week);
      if (weekdays)
        await insertAuditLog(tx, {
          id: uuidv7(),
          actorUserId: ctx.userId,
          action: 'workspace.hours_changed',
          targetType: 'workspace',
          targetId: id,
          detail: { weekdays },
        });
      return after;
    });
    if (!hours) throw new NotFoundException();
    return { timezone: hours.timezone, isDefault: hours.isDefault, week: daysOf(hours.week) };
  }
}

/** The request context of an Owner or an Admin; 403 for any other role. */
function owners() {
  const ctx = currentRequestContext();
  if (!mayInvite(ctx.role)) throw new ForbiddenException();
  return ctx;
}
