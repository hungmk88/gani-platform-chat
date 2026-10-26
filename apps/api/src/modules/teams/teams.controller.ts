import {
  createTeam,
  deleteTeam,
  insertAuditLog,
  listTeams,
  listWorkspaceMembers,
  lockTeam,
  lockWorkspace,
  setTeamChannels,
  setTeamMembers,
  teamUserIds,
  teamWorkspaceId,
  updateTeam,
  type TeamChange,
  type TeamRow,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { mayInvite } from '../members/members.permissions.js';
import { currentRequestContext } from '../request-context/request-context.js';
import {
  TeamChangeSchema,
  TeamChannelsBodySchema,
  TeamCreateSchema,
  TeamIdSchema,
  TeamListQuerySchema,
  TeamMembersBodySchema,
} from './teams.schemas.js';
import { teamView } from './teams.view.js';

/** 409 of a team still in use: the default one of its workspace, or one that answers a channel (endpoint-M8 §1, N161). */
export class TeamInUseError extends Error {
  readonly status = 409;
  readonly code = 'team_in_use';
  constructor() {
    super(
      'This team is the default one of its workspace or answers a channel: make another team the default, or give its channels to another team, first.',
    );
    this.name = 'TeamInUseError';
  }
}

/**
 * The teams of a workspace for /settings/teams (A4, spec-M8 §3.1, endpoint-M8 §1, N160). An Owner or an Admin reads and changes them
 * (Phụ lục B "Cài đặt workspace, kênh, team"); a Manager reads only the teams they are in. Every write locks the workspace first and
 * the team second, and is audited.
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

  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(TeamIdSchema)) id: string,
    @Body(new ZodPipe(TeamChangeSchema)) body: TeamChange,
  ) {
    const team = await this.write(id, async (tx, before) => {
      const changed = (Object.keys(body) as (keyof TeamChange)[]).filter(
        (key) => body[key] !== before[key],
      );
      if (changed.length === 0) return before;
      const after = await updateTeam(tx, before, body);
      const text = (value: string | boolean | null) =>
        typeof value === 'boolean' ? String(value) : value;
      await this.audit(
        tx,
        'team.updated',
        id,
        Object.fromEntries(
          changed.flatMap((key) => [
            [`${key}From`, text(before[key])],
            [`${key}To`, text(after[key])],
          ]),
        ),
      );
      return after;
    });
    return teamView(team);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(TeamIdSchema)) id: string) {
    await this.write(id, async (tx, team) => {
      if (team.isDefault || team.channelIds.length > 0) throw new TeamInUseError();
      await deleteTeam(tx, id);
      await this.audit(tx, 'team.deleted', id, { slug: team.slug });
      return team;
    });
  }

  /** The people of a team; a Manager only of a team they are in. */
  @Get(':id/members')
  async members(@Param('id', new ZodPipe(TeamIdSchema)) id: string) {
    const ctx = currentRequestContext();
    const own = ctx.role === 'manager';
    if (!own && !mayInvite(ctx.role)) throw new ForbiddenException();
    const data = await this.database.withTenant(ctx, async (tx) => {
      const workspaceId = await teamWorkspaceId(tx, id);
      if (!workspaceId) throw new NotFoundException();
      const users = new Set(await teamUserIds(tx, id));
      if (own && !users.has(ctx.userId)) throw new NotFoundException();
      return (await listWorkspaceMembers(tx, workspaceId)).filter((m) => users.has(m.userId));
    });
    return { data };
  }

  /** Makes `memberIds`, people of the team's workspace, the people of the team (N160). */
  @Put(':id/members')
  async setMembers(
    @Param('id', new ZodPipe(TeamIdSchema)) id: string,
    @Body(new ZodPipe(TeamMembersBodySchema)) body: { memberIds: string[] },
  ) {
    const ctx = currentRequestContext();
    let data: Awaited<ReturnType<typeof listWorkspaceMembers>> = [];
    await this.write(id, async (tx, team) => {
      const inWorkspace = await listWorkspaceMembers(tx, team.workspaceId);
      const byMember = new Map(inWorkspace.map((m) => [m.memberId, m.userId]));
      const userIds = body.memberIds.map((memberId) => byMember.get(memberId));
      if (userIds.some((user) => user === undefined))
        throw new ValidationFailedError(['memberIds: not a member of the workspace']);
      const { added, removed } = await setTeamMembers(tx, {
        teamId: id,
        userIds: userIds as string[],
        actorUserId: ctx.userId,
        newId: uuidv7,
      });
      if (added + removed > 0) await this.audit(tx, 'team.members_changed', id, { added, removed });
      const chosen = new Set(body.memberIds);
      data = inWorkspace.filter((m) => chosen.has(m.memberId));
      return team;
    });
    return { data };
  }

  /** Makes `channelIds`, channel accounts of the team's workspace, the channels the team answers; one of another team moves (N161). */
  @Put(':id/channels')
  async setChannels(
    @Param('id', new ZodPipe(TeamIdSchema)) id: string,
    @Body(new ZodPipe(TeamChannelsBodySchema)) body: { channelIds: string[] },
  ) {
    const team = await this.write(id, async (tx, before) => {
      const changed = await setTeamChannels(tx, {
        teamId: id,
        workspaceId: before.workspaceId,
        channelIds: body.channelIds,
      });
      if (!changed) throw new ValidationFailedError(['channelIds: not a channel of the workspace']);
      if (changed.added + changed.removed === 0) return before;
      await this.audit(tx, 'team.channels_changed', id, changed);
      return (await lockTeam(tx, id)) as TeamRow;
    });
    return teamView(team);
  }

  /** A write of an Owner or an Admin on a live team: the workspace locked, then the team, in one TenantTx. */
  private async write(id: string, fn: (tx: TenantTx, team: TeamRow) => Promise<TeamRow>) {
    const ctx = currentRequestContext();
    if (!mayInvite(ctx.role)) throw new ForbiddenException();
    return this.database.withTenant(ctx, async (tx) => {
      const workspaceId = await teamWorkspaceId(tx, id);
      if (!workspaceId || !(await lockWorkspace(tx, workspaceId))) throw new NotFoundException();
      const team = await lockTeam(tx, id);
      if (!team) throw new NotFoundException();
      return fn(tx, team);
    });
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
