import {
  InvalidCursorError,
  listConversations,
  listMessages,
  loadConversationView,
  type ConversationListQuery as StoreQuery,
  type TenantTx,
} from '@gani/db';
import { Controller, ForbiddenException, Get, Inject, Param, Query } from '@nestjs/common';
import { ConversationNotFoundError } from '@gani/conversations';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import {
  ConversationIdSchema,
  ConversationListQuerySchema,
  MessageListQuerySchema,
  type ConversationListQuery,
} from './conversations.schemas.js';
import { canSee, readScope } from './permissions.js';

/**
 * The Inbox reads (Brief P9): the list, one conversation, its messages. Everything runs in the TenantTx of the session, so RLS
 * already limits it to the organisation and the workspaces of the person; the role narrows it further (permissions.ts). A
 * conversation the person may not see is 404, the same as one that does not exist (P9).
 */
@Controller('v1/conversations')
export class ConversationsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  list(@Query(new ZodPipe(ConversationListQuerySchema)) q: ConversationListQuery) {
    const ctx = allowedToRead();
    const scope = readScope(ctx.role);
    const query: StoreQuery = {
      limit: q.limit,
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
      ...(q.workspaceId === undefined ? {} : { workspaceId: q.workspaceId }),
      ...(q.state === undefined ? {} : { states: [q.state] }),
      ...(q.hold === undefined ? {} : { afterHoursHold: q.hold === 'true' }),
      ...(q.assignee === 'me' ? { assigned: { userId: ctx.userId } } : {}),
      ...(q.assignee === 'none' ? { assigned: 'none' as const } : {}),
      ...(scope === 'mine_or_unassigned' ? { mineOrUnassigned: ctx.userId } : {}),
    };
    return this.read(ctx, (tx) => listConversations(tx, query)).then((page) => ({
      data: page.rows,
      nextCursor: page.nextCursor,
    }));
  }

  @Get(':id')
  detail(@Param('id', new ZodPipe(ConversationIdSchema)) id: string) {
    const ctx = allowedToRead();
    return this.read(ctx, (tx) => visible(tx, ctx, id));
  }

  @Get(':id/messages')
  messages(
    @Param('id', new ZodPipe(ConversationIdSchema)) id: string,
    @Query(new ZodPipe(MessageListQuerySchema)) q: { cursor?: string | undefined; limit: number },
  ) {
    const ctx = allowedToRead();
    return this.read(ctx, async (tx) => {
      await visible(tx, ctx, id);
      const page = await listMessages(tx, id, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
      });
      return { data: page.rows, nextCursor: page.nextCursor };
    });
  }

  /** One read-only transaction of the session; a cursor this API did not give is the client's mistake (400), not a 500. */
  private async read<T>(ctx: RequestContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    try {
      return await this.database.withTenant(ctx, fn);
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new ValidationFailedError(['cursor: invalid']);
      throw error;
    }
  }
}

/** The session's context, once its role may read conversations at all (marketing and viewer may not: 403). */
function allowedToRead(): RequestContext {
  const ctx = currentRequestContext();
  if (readScope(ctx.role) === 'none') throw new ForbiddenException();
  return ctx;
}

async function visible(tx: TenantTx, ctx: RequestContext, id: string) {
  const conversation = await loadConversationView(tx, id);
  if (!conversation || !canSee(ctx.role, ctx.userId, conversation))
    throw new ConversationNotFoundError();
  return conversation;
}
