import { createQuickReply, listQuickReplies, QuickReplyShortcutTakenError } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { mayReadQuickReplies, mayWriteQuickReplies } from './quick-replies.permissions.js';
import { QuickReplyCreateSchema, QuickReplyListQuerySchema } from './quick-replies.schemas.js';
import { quickReplyView } from './quick-replies.view.js';

/** 409 of a shortcut that another live template of the workspace has. */
export class ShortcutTakenError extends Error {
  readonly status = 409;
  readonly code = 'duplicate_resource';
  constructor() {
    super('Another template of this workspace has this shortcut.');
    this.name = 'ShortcutTakenError';
  }
}

/**
 * The canned answers of a workspace (C7, spec-M8 §3.2, endpoint-M8 §2, N163). An Owner, an Admin or a Manager makes and changes them;
 * every role that answers customers reads them. A workspace the session does not belong to is a 404, as row-level security hides it.
 */
@Controller('v1/quick-replies')
export class QuickRepliesController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(
    @Query(new ZodPipe(QuickReplyListQuerySchema))
    q: {
      workspaceId: string;
      q?: string;
      tag?: string;
    },
  ) {
    const ctx = this.allowed(mayReadQuickReplies, q.workspaceId);
    const rows = await this.database.withTenant(ctx, (tx) =>
      listQuickReplies(tx, {
        workspaceId: q.workspaceId,
        ...(q.q ? { q: q.q } : {}),
        ...(q.tag ? { tag: q.tag } : {}),
      }),
    );
    return { data: rows.map(quickReplyView) };
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(
    @Body(new ZodPipe(QuickReplyCreateSchema))
    body: {
      workspaceId: string;
      shortcut: string;
      body: string;
      tags?: string[];
    },
  ) {
    const ctx = this.allowed(mayWriteQuickReplies, body.workspaceId);
    const row = await this.taken(() =>
      this.database.withTenant(ctx, (tx) =>
        createQuickReply(tx, {
          id: uuidv7(),
          workspaceId: body.workspaceId,
          shortcut: body.shortcut,
          body: body.body,
          tags: body.tags ?? [],
          createdBy: ctx.userId,
        }),
      ),
    );
    return quickReplyView(row);
  }

  /** The request context of a person whose role may do this, in `workspaceId` when one is named. */
  private allowed(
    may: (role: ReturnType<typeof currentRequestContext>['role']) => boolean,
    workspaceId?: string,
  ) {
    const ctx = currentRequestContext();
    if (!may(ctx.role)) throw new ForbiddenException();
    if (workspaceId !== undefined && !ctx.workspaceIds.includes(workspaceId))
      throw new NotFoundException();
    return ctx;
  }

  private async taken<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof QuickReplyShortcutTakenError) throw new ShortcutTakenError();
      throw error;
    }
  }
}
