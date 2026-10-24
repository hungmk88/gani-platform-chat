import {
  insertAuditLog,
  listWorkspaces,
  lockWorkspace,
  updateWorkspace,
  type WorkspaceChange,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { WorkspaceChangeSchema, WorkspaceIdSchema } from './workspaces.schemas.js';
import { workspaceView } from './workspaces.view.js';

/**
 * The workspaces of the organisation for /settings/workspace (Brief P9 `GET /v1/workspaces`, spec-M8 §3.4, N157): an Owner or an Admin
 * (Phụ lục B "Cài đặt workspace"). A workspace is made by the command tenant:create-workspace (spec-M8 A2), not here (N157).
 */
@Controller('v1/workspaces')
export class WorkspacesController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list() {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const rows = await this.database.withTenant(ctx, (tx) => listWorkspaces(tx));
    return { data: rows.map(workspaceView) };
  }

  /**
   * The name, the time zone or the default limit of conversations of a workspace. One TenantTx: the workspace locked, changed, audited
   * with what changed (`nameFrom`, `nameTo`, …). Setting the same values again changes nothing and writes no audit; no Idempotency-Key.
   */
  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(WorkspaceIdSchema)) id: string,
    @Body(new ZodPipe(WorkspaceChangeSchema)) body: WorkspaceChange,
  ) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const row = await this.database.withTenant(ctx, async (tx) => {
      const before = await lockWorkspace(tx, id);
      if (!before) throw new NotFoundException();
      const changed = (Object.keys(body) as (keyof WorkspaceChange)[]).filter(
        (key) => body[key] !== before[key],
      );
      if (changed.length === 0) return before;
      const after = await updateWorkspace(tx, id, body);
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: id,
        detail: Object.fromEntries(
          changed.flatMap((key) => [
            [`${key}From`, before[key]],
            [`${key}To`, after[key]],
          ]),
        ),
      });
      return after;
    });
    return workspaceView(row);
  }
}
