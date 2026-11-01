import {
  createBotFlow,
  listBotFlows,
  loadBotFlow,
  loadBotFlowVersion,
  type BotFlowVersionRow,
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
  NotFoundException,
  Param,
  Post,
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
} from './bot-flows.schemas.js';
import { botFlowVersionView, botFlowView } from './bot-flows.view.js';

/**
 * The scripted bot flows of a workspace (D1a3a, Brief P9, U63): list, make, read with the graph. Only an Owner, an Admin or a Manager
 * (Phụ lục B); a workspace or a flow outside the session's workspaces is a 404, as row-level security hides another organisation's.
 * Saving a draft, publishing and deleting come in D1a3b.
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
