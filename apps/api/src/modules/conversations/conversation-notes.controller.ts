import { ConversationNotFoundError } from '@gani/conversations';
import {
  addConversationNote,
  insertAuditLog,
  InvalidCursorError,
  listConversationNotes,
  loadConversationView,
  lockConversation,
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
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import {
  ConversationNoteCreateSchema,
  ConversationNoteListQuerySchema,
} from './conversation-notes.schemas.js';
import { noteView } from './conversation-notes.view.js';
import { ConversationIdSchema } from './conversations.schemas.js';
import { actionScope, canSee, mayAct, readScope } from './permissions.js';

/**
 * The internal notes of a conversation (C6, N194; CEO 04/11/2026). Read: whoever sees the conversation (`canSee`; Marketing and Viewer
 * 403). Write: Phụ lục B "Trả lời khách, ghi chú nội bộ", the same row as answering the customer, so the scope of `send_message`
 * (Owner, Admin, Manager any conversation they see; Sales and Support one they hold), in every state, the closed ones too. Audited
 * `conversation.note_added {noteId, kind}`; the body is never logged nor audited (it may name the customer).
 */
@Controller('v1/conversations/:id/notes')
export class ConversationNotesController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  add(
    @Param('id', new ZodPipe(ConversationIdSchema)) id: string,
    @Body(new ZodPipe(ConversationNoteCreateSchema)) body: { body: string },
  ) {
    const ctx = currentRequestContext();
    if (actionScope(ctx.role, 'send_message') === 'none') throw new ForbiddenException();
    return this.database.withTenant(ctx, async (tx) => {
      // The lock of the conversation, as every write on it (N107): the holder read below stays the holder until COMMIT.
      await lockConversation(tx, id);
      const conversation = await visible(tx, ctx, id);
      if (!mayAct(ctx.role, ctx.userId, 'send_message', conversation))
        throw new ForbiddenException();
      const note = await addConversationNote(tx, {
        id: uuidv7(),
        conversationId: id,
        kind: 'note',
        authorUserId: ctx.userId,
        body: body.body,
      });
      await insertAuditLog(tx, {
        id: uuidv7(),
        actorUserId: ctx.userId,
        action: 'conversation.note_added',
        targetType: 'conversation',
        targetId: id,
        detail: { noteId: note.id, kind: note.kind },
      });
      return noteView(note);
    });
  }

  @Get()
  async list(
    @Param('id', new ZodPipe(ConversationIdSchema)) id: string,
    @Query(new ZodPipe(ConversationNoteListQuerySchema))
    q: { cursor?: string | undefined; limit: number },
  ) {
    const ctx = currentRequestContext();
    if (readScope(ctx.role) === 'none') throw new ForbiddenException();
    try {
      return await this.database.withTenant(ctx, async (tx) => {
        await visible(tx, ctx, id);
        const page = await listConversationNotes(tx, id, {
          limit: q.limit,
          ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        });
        return { data: page.rows.map(noteView), nextCursor: page.nextCursor };
      });
    } catch (error) {
      if (error instanceof InvalidCursorError) throw new ValidationFailedError(['cursor: invalid']);
      throw error;
    }
  }
}

/** The conversation, once RLS and the role's reading scope let this person see it; 404 otherwise (P9). */
async function visible(tx: TenantTx, ctx: RequestContext, id: string) {
  const conversation = await loadConversationView(tx, id);
  if (!conversation || !canSee(ctx.role, ctx.userId, conversation))
    throw new ConversationNotFoundError();
  return conversation;
}
