import {
  insertAuditLog,
  listWorkspaceMembers,
  listWorkspaces,
  lockWorkspace,
  membersById,
  setWorkspaceMembers,
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
  Put,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext } from '../request-context/request-context.js';
import {
  WorkspaceChangeSchema,
  WorkspaceIdSchema,
  WorkspaceMembersBodySchema,
} from './workspaces.schemas.js';
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

  /** The people of a workspace (N159), by role. */
  @Get(':id/members')
  async members(@Param('id', new ZodPipe(WorkspaceIdSchema)) id: string) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const data = await this.database.withTenant(ctx, async (tx) => {
      if (!(await lockWorkspace(tx, id))) throw new NotFoundException();
      return listWorkspaceMembers(tx, id);
    });
    return { data };
  }

  /**
   * Makes `memberIds` the people of a workspace (N159): the others leave it, the new ones join. One TenantTx: the workspace locked, the
   * ids checked (members of the organisation, active or suspended), the list set, audited with the counts. Their next request sees it;
   * their socket within 60 s (revalidate). Setting the same list again changes nothing, so no Idempotency-Key.
   */
  @Put(':id/members')
  async setMembers(
    @Param('id', new ZodPipe(WorkspaceIdSchema)) id: string,
    @Body(new ZodPipe(WorkspaceMembersBodySchema)) body: { memberIds: string[] },
  ) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const data = await this.database.withTenant(ctx, async (tx) => {
      if (!(await lockWorkspace(tx, id))) throw new NotFoundException();
      const people = await membersById(tx, body.memberIds);
      if (people.size !== body.memberIds.length)
        throw new ValidationFailedError(['memberIds: not a member of the organisation']);
      const { added, removed } = await setWorkspaceMembers(tx, {
        workspaceId: id,
        userIds: [...people.values()],
        actorUserId: ctx.userId,
        newId: uuidv7,
      });
      if (added + removed > 0)
        await insertAuditLog(tx, {
          id: uuidv7(),
          actorUserId: ctx.userId,
          action: 'workspace.members_changed',
          targetType: 'workspace',
          targetId: id,
          detail: { added, removed },
        });
      return listWorkspaceMembers(tx, id);
    });
    return { data };
  }
}
