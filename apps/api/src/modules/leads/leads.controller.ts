import {
  changeLeadStage,
  closeLead,
  createLead,
  getLead,
  leadReadScope,
  listLeads,
  mayCreateLead,
  readPipeline,
  type LeadViewer,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
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

import { UuidSchema } from '../../openapi/schemas.js';
import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { httpErrorOf } from './leads.errors.js';
import {
  LeadCloseSchema,
  LeadCreateSchema,
  LeadIdSchema,
  LeadListQuerySchema,
  LeadStageChangeSchema,
  type LeadCloseBody,
  type LeadCreateBody,
  type LeadListQuery,
  type LeadStageChangeBody,
} from './leads.schemas.js';
import { leadEventView, leadView } from './leads.view.js';

/**
 * The pipeline and the leads of the session's workspaces (L4, L5; N188, N196, N201). Who sees and changes what is the store's
 * (lead-access.ts): a Sales reads and changes only the leads they made or own (another is a 404), Marketing and Viewer read only (403
 * on a change), Support nothing (403). A workspace the session does not belong to is a 404, as row-level security hides it. Every
 * change writes its event, and closing its audit row, in the store's transaction.
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

  /** Make an open lead at the given step or the first one (Idempotency-Key, N134); the maker is the caller. */
  @Post('leads')
  @HttpCode(201)
  @Idempotent()
  async create(@Body(new ZodPipe(LeadCreateSchema)) body: LeadCreateBody) {
    const ctx = writer(body.workspaceId);
    const row = await this.run(ctx, (tx) =>
      createLead(tx, viewerOf(ctx), {
        workspaceId: body.workspaceId,
        customerId: body.customerId,
        title: body.title,
        ...(body.conversationId === undefined ? {} : { conversationId: body.conversationId }),
        ...(body.stageId === undefined ? {} : { stageId: body.stageId }),
        ...(body.ownerUserId === undefined ? {} : { ownerUserId: body.ownerUserId }),
        newId: uuidv7,
      }),
    );
    return leadView(row);
  }

  /** Move an open lead read at `version` to another step of its pipeline. */
  @Patch('leads/:id/stage')
  async stage(
    @Param('id', new ZodPipe(LeadIdSchema)) id: string,
    @Body(new ZodPipe(LeadStageChangeSchema)) body: LeadStageChangeBody,
  ) {
    const ctx = writer();
    const row = await this.run(ctx, (tx) =>
      changeLeadStage(tx, viewerOf(ctx), {
        id,
        stageId: body.stageId,
        version: body.version,
        newId: uuidv7,
      }),
    );
    if (!row) throw new NotFoundException();
    return leadView(row);
  }

  /** Win or lose an open lead read at `version`, for good; the store writes the event and the audit row. */
  @Post('leads/:id/close')
  @HttpCode(200)
  async close(
    @Param('id', new ZodPipe(LeadIdSchema)) id: string,
    @Body(new ZodPipe(LeadCloseSchema)) body: LeadCloseBody,
  ) {
    const ctx = writer();
    const row = await this.run(ctx, (tx) =>
      closeLead(tx, viewerOf(ctx), {
        id,
        version: body.version,
        outcome: body.outcome,
        ...(body.lostReason === undefined ? {} : { lostReason: body.lostReason }),
        newId: uuidv7,
      }),
    );
    if (!row) throw new NotFoundException();
    return leadView(row);
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

/**
 * The context of a person who changes leads: Owner, Admin, Manager, Sales (mayCreateLead, the writers of lead-access.ts); Marketing,
 * Viewer and Support are 403 before anything. In `workspaceId` when one is named, else 404.
 */
function writer(workspaceId?: string): RequestContext {
  const ctx = currentRequestContext();
  if (!mayCreateLead(ctx.role)) throw new ForbiddenException();
  if (workspaceId !== undefined && !ctx.workspaceIds.includes(workspaceId))
    throw new NotFoundException();
  return ctx;
}
