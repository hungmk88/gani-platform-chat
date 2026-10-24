import { createTeam, insertAuditLog, listTeams, lockWorkspace, type TenantTx } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { TeamCreateSchema, TeamListQuerySchema } from './teams.schemas.js';
import { teamView } from './teams.view.js';

/**
 * The teams of a workspace for /settings/teams (A4, spec-M8 §3.1, endpoint-M8 §1, N160). An Owner or an Admin reads and changes them
 * (Phụ lục B "Cài đặt workspace, kênh, team"); a Manager reads only the teams they are in. Every write is audited.
 */
@Controller('v1/teams')
export class TeamsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(TeamListQuerySchema)) q: { workspaceId: string }) {
    const ctx = currentRequestContext();
    const own = ctx.role === 'manager';
    if (!own && !mayInvite(ctx.role)) throw new ForbiddenException();
    const rows = await this.database.withTenant(ctx, async (tx) => {
      if (!(await lockWorkspace(tx, q.workspaceId))) throw new NotFoundException();
      return listTeams(tx, {
        workspaceId: q.workspaceId,
        ...(own ? { memberUserId: ctx.userId } : {}),
      });
    });
    return { data: rows.map(teamView) };
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(
    @Body(new ZodPipe(TeamCreateSchema))
    body: {
      workspaceId: string;
      name: string;
      description?: string | null;
    },
  ) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    const team = await this.database.withTenant(ctx, async (tx) => {
      if (!(await lockWorkspace(tx, body.workspaceId))) throw new NotFoundException();
      const made = await createTeam(tx, {
        id: uuidv7(),
        workspaceId: body.workspaceId,
        name: body.name,
        description: body.description ?? null,
        createdBy: ctx.userId,
      });
      await this.audit(tx, 'team.created', made.id, { slug: made.slug });
      return made;
    });
    return teamView(team);
  }

  private audit(
    tx: TenantTx,
    action: string,
    targetId: string,
    detail: Readonly<Record<string, string | number | null>>,
  ) {
    const { userId } = currentRequestContext();
    return insertAuditLog(tx, {
      id: uuidv7(),
      actorUserId: userId,
      action,
      targetType: 'team',
      targetId,
      detail,
    });
  }
}
