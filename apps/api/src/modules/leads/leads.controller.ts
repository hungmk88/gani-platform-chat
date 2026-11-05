import {
  getLead,
  leadReadScope,
  listLeads,
  readPipeline,
  type LeadViewer,
  type TenantTx,
} from '@gani/db';
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';

import { UuidSchema } from '../../openapi/schemas.js';
import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { httpErrorOf } from './leads.errors.js';
import { LeadIdSchema, LeadListQuerySchema, type LeadListQuery } from './leads.schemas.js';
import { leadEventView, leadView } from './leads.view.js';

/**
 * Reading the pipeline and the leads of the session's workspaces (L4; N188, N196, N201). Who sees what is the store's (lead-access.ts):
 * a Sales reads only the leads they made or own (another is a 404), Support nothing (403). A workspace the session does not belong to
 * is a 404, as row-level security hides it. Making, moving and closing a lead come in L5.
 */
@Controller('v1')
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** The steps of the workspace in order and its reasons to lose in force. */
  @Get('workspaces/:id/pipeline')
  async pipeline(@Param('id', new ZodPipe(UuidSchema)) id: string) {
    const ctx = reader(id);
    const pipeline = await this.run(ctx, (tx) => readPipeline(tx, viewerOf(ctx), id));
    return { data: pipeline.stages, lostReasons: pipeline.lostReasons };
  }

  /** A page of the leads the person sees, newest first; `me` is the caller. */
  @Get('leads')
  async list(@Query(new ZodPipe(LeadListQuerySchema)) q: LeadListQuery) {
    const ctx = reader(q.workspaceId);
    const me = (who: string) => (who === 'me' ? ctx.userId : who);
    const page = await this.run(ctx, (tx) =>
      listLeads(tx, viewerOf(ctx), {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.workspaceId === undefined ? {} : { workspaceId: q.workspaceId }),
        ...(q.stageId === undefined ? {} : { stageId: q.stageId }),
        ...(q.status === undefined ? {} : { status: q.status }),
        ...(q.owner === undefined ? {} : { owner: me(q.owner) }),
        ...(q.createdBy === undefined ? {} : { createdBy: me(q.createdBy) }),
        ...(q.customerId === undefined ? {} : { customerId: q.customerId }),
      }),
    );
    return { data: page.rows.map(leadView), nextCursor: page.nextCursor };
  }

  /** One lead with its events, oldest first, at most 500: past it the log says so with ids only (N201). */
  @Get('leads/:id')
  async detail(@Param('id', new ZodPipe(LeadIdSchema)) id: string) {
    const ctx = reader();
    const found = await this.run(ctx, (tx) => getLead(tx, viewerOf(ctx), id));
    if (!found) throw new NotFoundException();
    if (found.eventsCapped)
      this.logger.warn(`lead_events_capped lead=${id} org=${ctx.orgId} trace=${ctx.traceId}`);
    return { ...leadView(found.lead), events: found.events.map(leadEventView) };
  }

  /** One transaction of the session, the refusals of the store as HTTP answers. */
  private async run<T>(ctx: RequestContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      throw httpErrorOf(error);
    }
  }
}

const viewerOf = (ctx: RequestContext): LeadViewer => ({ role: ctx.role, userId: ctx.userId });

/** The context of a person who reads leads (Support is 403 before anything), in `workspaceId` when one is named (else 404). */
function reader(workspaceId?: string): RequestContext {
  const ctx = currentRequestContext();
  if (leadReadScope(ctx.role) === 'none') throw new ForbiddenException();
  if (workspaceId !== undefined && !ctx.workspaceIds.includes(workspaceId))
    throw new NotFoundException();
  return ctx;
}
