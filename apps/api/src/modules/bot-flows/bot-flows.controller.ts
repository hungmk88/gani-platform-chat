import {
  BotGraphInvalidError,
  createBotFlow,
  deleteBotFlow,
  insertAuditLog,
  listBotFlows,
  loadBotFlow,
  loadBotFlowVersion,
  publishBotFlow,
  saveBotFlowDraft,
  type BotFlowVersionRow,
  type BotGraph,
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
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { mayBuildBotFlows } from './bot-flows.permissions.js';
import {
  BotFlowCreateSchema,
  BotFlowIdSchema,
  BotFlowListQuerySchema,
  BotGraphSchema,
} from './bot-flows.schemas.js';
import { botFlowVersionView, botFlowView } from './bot-flows.view.js';

/** 422: the graph cannot run (bot-flow-store's rules); the detail names the rule, never a node's content. */
export class BotFlowGraphHttpError extends Error {
  readonly status = 422;
  readonly code = 'bot_flow_graph_invalid';
  constructor(problem: string) {
    super(`The graph breaks a rule: ${problem}.`);
    this.name = 'BotFlowGraphHttpError';
  }
}

/**
 * The scripted bot flows of a workspace (D1a3, Brief P9, U63): list, make, read with the graph (D1a3a); save the draft, publish it,
 * delete the flow (D1a3b). Only an Owner, an Admin or a Manager (Phụ lục B); a workspace or a flow outside the session's workspaces is
 * a 404, as row-level security hides another organisation's. Publishing and deleting are audited (bot_flow.published, bot_flow.deleted).
 */
@Controller('v1/bot-flows')
export class BotFlowsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(BotFlowListQuerySchema)) q: { workspaceId: string }) {
    const ctx = this.allowed(q.workspaceId);
    const rows = await this.database.withTenant(ctx, (tx) =>
      listBotFlows(tx, { workspaceId: q.workspaceId }),
    );
    return { data: rows.map((row) => botFlowView(row, row.publishedVersion)) };
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(
    @Body(new ZodPipe(BotFlowCreateSchema)) body: { workspaceId: string; name: string },
  ) {
    const ctx = this.allowed(body.workspaceId);
    return this.database.withTenant(ctx, async (tx) => {
      const { flow } = await createBotFlow(tx, {
        workspaceId: body.workspaceId,
        name: body.name,
        createdBy: ctx.userId,
        newId: uuidv7,
      });
      return (await this.detail(tx, flow.id, ctx.workspaceIds))!;
    });
  }

  @Get(':id')
  async read(@Param('id', new ZodPipe(BotFlowIdSchema)) id: string) {
    const ctx = this.allowed();
    const found = await this.database.withTenant(ctx, (tx) =>
      this.detail(tx, id, ctx.workspaceIds),
    );
    if (!found) throw new NotFoundException();
    return found;
  }

  /** Saves the whole graph as the new draft (the old draft is given up, never deleted). */
  @Put(':id/draft')
  async saveDraft(
    @Param('id', new ZodPipe(BotFlowIdSchema)) id: string,
    @Body(new ZodPipe(BotGraphSchema)) graph: BotGraph,
  ) {
    const ctx = this.allowed();
    return this.database.withTenant(ctx, async (tx) => {
      await this.mine(tx, id, ctx.workspaceIds);
      await this.graphRules(() =>
        saveBotFlowDraft(tx, { flowId: id, graph, savedBy: ctx.userId, newId: uuidv7 }),
      );
      return (await this.detail(tx, id, ctx.workspaceIds))!;
    });
  }

  /** Publishes the draft as the next version; an empty or broken draft is a 422 and nothing changes. */
  @Post(':id/versions')
  @HttpCode(201)
  @Idempotent()
  async publish(@Param('id', new ZodPipe(BotFlowIdSchema)) id: string) {
    const ctx = this.allowed();
    return this.database.withTenant(ctx, async (tx) => {
      await this.mine(tx, id, ctx.workspaceIds);
      const { version } = await this.graphRules(() =>
        publishBotFlow(tx, { flowId: id, publishedBy: ctx.userId, newId: uuidv7 }),
      );
      await this.audit(tx, 'bot_flow.published', id, { version });
      return (await this.detail(tx, id, ctx.workspaceIds))!;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ZodPipe(BotFlowIdSchema)) id: string) {
    const ctx = this.allowed();
    await this.database.withTenant(ctx, async (tx) => {
      await this.mine(tx, id, ctx.workspaceIds);
      if (!(await deleteBotFlow(tx, id))) throw new NotFoundException();
      await this.audit(tx, 'bot_flow.deleted', id, {});
    });
  }

  /** 404 unless the live flow `id` is in one of the session's workspaces. */
  private async mine(tx: TenantTx, id: string, workspaceIds: readonly string[]) {
    const flow = await loadBotFlow(tx, id);
    if (!flow || !workspaceIds.includes(flow.workspaceId)) throw new NotFoundException();
  }

  private async graphRules<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BotGraphInvalidError) throw new BotFlowGraphHttpError(error.problem);
      throw error;
    }
  }

  private audit(
    tx: TenantTx,
    action: string,
    targetId: string,
    detail: Readonly<Record<string, number>>,
  ) {
    return insertAuditLog(tx, {
      id: uuidv7(),
      actorUserId: currentRequestContext().userId,
      action,
      targetType: 'bot_flow',
      targetId,
      detail,
    });
  }

  /** The flow `id` with its draft and its latest published version, or null when the session's workspaces do not hold it. */
  private async detail(tx: TenantTx, id: string, workspaceIds: readonly string[]) {
    const flow = await loadBotFlow(tx, id);
    if (!flow || !workspaceIds.includes(flow.workspaceId)) return null;
    const version = (versionId: string) =>
      loadBotFlowVersion(tx, versionId) as Promise<BotFlowVersionRow>;
    const draft = await version(flow.draftVersionId);
    const published = flow.publishedVersionId ? await version(flow.publishedVersionId) : null;
    return {
      ...botFlowView(flow, published?.version ?? null),
      draft: botFlowVersionView(draft),
      published: published ? botFlowVersionView(published) : null,
    };
  }

  /** The request context of a builder of flows, in `workspaceId` when one is named. */
  private allowed(workspaceId?: string) {
    const ctx = currentRequestContext();
    if (!mayBuildBotFlows(ctx.role)) throw new ForbiddenException();
    if (workspaceId !== undefined && !ctx.workspaceIds.includes(workspaceId))
      throw new NotFoundException();
    return ctx;
  }
}
