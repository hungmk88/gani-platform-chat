import {
  insertPendingDelivery,
  loadConversationView,
  lockConversation,
  loadMessageView,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import {
  ChannelPolicyService,
  ConversationNotActiveError,
  ConversationNotFoundError,
  MessageService,
} from '@gani/conversations';
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';

import { ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { variablesOf } from '../quick-replies/variables.js';
import { currentRequestContext } from '../request-context/request-context.js';
import { ConversationIdSchema, SendMessageBodySchema } from './conversations.schemas.js';
import { actionScope, canSee, mayAct } from './permissions.js';

/** 422 of a message that still holds a {{variable}} of a quick reply (C7, N163): nothing is sent, the Inbox fills it first. */
export class UnresolvedVariableError extends Error {
  readonly status = 422;
  readonly code = 'unresolved_variable';
  constructor() {
    super('The message still holds a {{…}} variable: fill it before sending.');
    this.name = 'UnresolvedVariableError';
  }
}

/** The states in which a person holds the conversation and may answer the customer (N146). Sending does not change the state. */
const ANSWERABLE = new Set(['HUMAN_ACTIVE', 'PENDING_CUSTOMER']);

/**
 * `POST /v1/conversations/{id}/messages` (Brief P9, channel-policy-spec §3, N146): the agent answers the customer. One TenantTx, in
 * this order: the lock of the conversation first (N107(4): before any write of a message or a state), then who may answer, then the
 * one gate of the channel, then the message (its `message.created` goes to the outbox in the same transaction) and its delivery,
 * `pending` until the outbound worker sends it (8b). A refusal writes nothing and calls no channel (C-N4).
 */
@Controller('v1/conversations/:id/messages')
export class SendMessageController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(ChannelPolicyService) private readonly policy: ChannelPolicyService,
  ) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  send(
    @Param('id', new ZodPipe(ConversationIdSchema)) id: string,
    @Body(new ZodPipe(SendMessageBodySchema)) body: { text: string },
  ) {
    const ctx = currentRequestContext();
    if (actionScope(ctx.role, 'send_message') === 'none') throw new ForbiddenException();
    // The text alone decides it, before any lock or read: a customer never receives "{{customer_name}}" (N163).
    if (variablesOf(body.text).length > 0) throw new UnresolvedVariableError();
    return this.database.withTenant(ctx, async (tx) => {
      await lockConversation(tx, id);
      const conversation = await loadConversationView(tx, id);
      if (!conversation || !canSee(ctx.role, ctx.userId, conversation))
        throw new ConversationNotFoundError();
      if (!mayAct(ctx.role, ctx.userId, 'send_message', conversation))
        throw new ForbiddenException();
      if (!ANSWERABLE.has(conversation.state)) throw new ConversationNotActiveError();
      await this.policy.check(tx, id, new Date());
      // check() refuses a conversation without a channel, so the account is there.
      const channelAccountId = conversation.channelAccountId as string;
      const stored = await this.messages.append(tx, {
        conversationId: id,
        senderKind: 'agent',
        senderUserId: ctx.userId,
        kind: 'text',
        body: body.text,
        traceId: ctx.traceId,
      });
      await insertPendingDelivery(tx, {
        id: uuidv7(),
        workspaceId: conversation.workspaceId,
        conversationId: id,
        messageId: stored.id,
        channelAccountId,
      });
      const message = await loadMessageView(tx, stored.id);
      if (!message) throw new ConversationNotFoundError();
      const { conversationId, ...view } = message;
      void conversationId;
      return { ...view, deliveryStatus: 'pending' as const };
    });
  }
}
