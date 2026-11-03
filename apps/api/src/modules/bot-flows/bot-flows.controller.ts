import { chooseTrigger, coreHandlers, simulate } from '@gani/bot-runtime';
import {
  BotFlowLimitError,
  BotGraphInvalidError,
  createBotFlow,
  deleteBotFlow,
  insertAuditLog,
  listBotFlows,
  listBotTriggers,
  loadBotFlow,
  loadBotFlowVersion,
  lockBotFlow,
  publishBotFlow,
  saveBotFlowDraft,
  updateBotFlow,
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
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { mayBuildBotFlows } from './bot-flows.permissions.js';
import {
  BotDryRunSchema,
  BotFlowChangeSchema,
  BotFlowCreateSchema,
  BotFlowIdSchema,
  BotFlowListQuerySchema,
  BotGraphSchema,
  type BotFlowChange,
} from './bot-flows.schemas.js';
import { botDryRunView, botFlowVersionView, botFlowView } from './bot-flows.view.js';

/** 422: the graph cannot run (bot-flow-store's rules); the detail names the rule, never a node's content. */
export class BotFlowGraphHttpError extends Error {
  readonly status = 422;
  readonly code = 'bot_flow_graph_invalid';
  constructor(problem: string) {
    super(`The graph breaks a rule: ${problem}.`);
    this.name = 'BotFlowGraphHttpError';
  }
}

/** 422: the workspace has BOT_FLOW_LIMIT live flows (U77 (c), CEO 03/11/2026). */
export class BotFlowLimitHttpError extends Error {
  readonly status = 422;
  readonly code = 'bot_flow_limit_reached';
  constructor() {
    super('The workspace has the most flows it may have.');
    this.name = 'BotFlowLimitHttpError';
  }
}

/** 422: a dry-run of the published version, or a resume, of a flow never published. */
export class BotFlowNotPublishedHttpError extends Error {
  readonly status = 422;
  readonly code = 'bot_flow_not_published';
  constructor() {
    super('The flow has no published version to run.');
    this.name = 'BotFlowNotPublishedHttpError';
  }
}

/**
 * The scripted bot flows of a workspace (D1a3, Brief P9, U63): list, make, read with the graph (D1a3a); save the draft, publish it,
 * delete the flow (D1a3b); rename it or change its description (U77 (i)). Only an Owner, an Admin or a Manager (Phụ lục B); a workspace or a flow outside the session's workspaces is
 * a 404, as row-level security hides another organisation's. Publishing, changing and deleting are audited (bot_flow.published, bot_flow.updated
 * {fields}, bot_flow.deleted).
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
    @Body(new ZodPipe(BotFlowCreateSchema))
    body: {
      workspaceId: string;
      name: string;
      description?: string;
    },
  ) {
    const ctx = this.allowed(body.workspaceId);
    return this.database.withTenant(ctx, async (tx) => {
      const { flow } = await this.limited(() =>
        createBotFlow(tx, {
          workspaceId: body.workspaceId,
          name: body.name,
          description: body.description ?? null,
          createdBy: ctx.userId,
          newId: uuidv7,
        }),
      );
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

  /**
   * Renames the flow, changes its description (null clears it), or pauses and resumes it (U77 (b)): a paused flow starts for no new
   * message and is no jump target, sessions running go on; only a published flow resumes (422 bot_flow_not_published), a draft is never
   * paused (400). The audit names the fields changed, never their values.
   */
  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(BotFlowIdSchema)) id: string,
    @Body(new ZodPipe(BotFlowChangeSchema)) body: BotFlowChange,
  ) {
    const ctx = this.allowed();
    return this.database.withTenant(ctx, async (tx) => {
      await this.mine(tx, id, ctx.workspaceIds);
      const current = await lockBotFlow(tx, id);
      if (!current) throw new NotFoundException();
      if (body.status === 'inactive' && current.status === 'draft')
        throw new ValidationFailedError(['status: a draft flow is not running']);
      if (body.status === 'active' && !(await loadBotFlow(tx, id))?.publishedVersionId)
        throw new BotFlowNotPublishedHttpError();
      await updateBotFlow(tx, id, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.status === undefined ? {} : { status: body.status }),
      });
      const fields = (['name', 'description', 'status'] as const).filter(
        (f) => body[f] !== undefined,
      );
      await this.audit(tx, 'bot_flow.updated', id, { fields: fields.join(',') });
      return (await this.detail(tx, id, ctx.workspaceIds))!;
    });
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

  /**
   * The dry-run (D1d, Brief P13): the sample script through the same steps as the bot (bot-runtime's simulate), on the draft or the
   * published version, in one tenant transaction that only reads. Nothing is sent, stored, audited nor logged; a jump goes to the
   * published version of the other flow, as the bot's does. A broken graph is a 200 with its code, for the builder to see.
   */
  @Post(':id/dry-run')
  @HttpCode(200)
  async dryRun(
    @Param('id', new ZodPipe(BotFlowIdSchema)) id: string,
    @Body(new ZodPipe(BotDryRunSchema))
    body: { version: 'draft' | 'published'; messages: string[]; customerName?: string },
  ) {
    const ctx = this.allowed();
    return this.database.withTenant(ctx, async (tx) => {
      const flow = await loadBotFlow(tx, id);
      if (!flow || !ctx.workspaceIds.includes(flow.workspaceId)) throw new NotFoundException();
      const versionId = body.version === 'draft' ? flow.draftVersionId : flow.publishedVersionId;
      if (!versionId) throw new BotFlowNotPublishedHttpError();
      const version = (await loadBotFlowVersion(tx, versionId)) as BotFlowVersionRow;
      const trigger = version.graph.nodes.find((n) => n.type === 'trigger');
      const first = { text: body.messages[0] ?? null, firstOfConversation: true };
      const sim = await simulate({
        graph: version.graph,
        messages: body.messages,
        handlers: coreHandlers({
          customer: { name: body.customerName ?? null },
          workspace: { isBusinessHours: true },
        }),
        resolveFlow: async (flowId) => {
          const target = (await listBotTriggers(tx, flow.workspaceId)).find(
            (t) => t.flowId === flowId,
          );
          const next = target ? await loadBotFlowVersion(tx, target.versionId) : null;
          return target && next ? { versionId: target.versionId, graph: next.graph } : null;
        },
      });
      return botDryRunView(
        id,
        { id: version.id, kind: body.version, number: version.version },
        trigger ? chooseTrigger([{ trigger: trigger.config }], first) !== null : false,
        sim,
      );
    });
  }

  /** 404 unless the live flow `id` is in one of the session's workspaces. */
  private async mine(tx: TenantTx, id: string, workspaceIds: readonly string[]) {
    const flow = await loadBotFlow(tx, id);
    if (!flow || !workspaceIds.includes(flow.workspaceId)) throw new NotFoundException();
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BotFlowLimitError) throw new BotFlowLimitHttpError();
      throw error;
    }
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
    detail: Readonly<Record<string, number | string>>,
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
