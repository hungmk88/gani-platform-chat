import { loadConversationView } from '@gani/db';
import type { ConversationEvent } from '@gani/domain';
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
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { ConversationStateMachine } from './conversation-state-machine.js';
import { ConversationIdSchema, VersionBodySchema } from './conversations.schemas.js';
import { ConversationNotFoundError, VersionConflictError } from './errors.js';
import { actionScope, canSee, mayAct, type ConversationAction } from './permissions.js';

const IdPipe = new ZodPipe(ConversationIdSchema);
const VersionPipe = new ZodPipe(VersionBodySchema);

/**
 * The actions of the Inbox (Brief P9, P14): each is one ConversationStateMachine transition in the TenantTx of the session, requires an
 * Idempotency-Key and answers 200 with the conversation as it is after the action (the UI does not update optimistically, P9).
 * The role decides first (403); a conversation the person may not see is 404 like one that does not exist. A claim is the exception:
 * any conversation of the person's workspaces may be claimed, so the 49 who lose a race are told who won (409 with
 * `assignedUserId`, PRR-05) instead of a 404 for a conversation that has just stopped being theirs to see.
 */
@Controller('v1/conversations/:id')
export class ConversationActionsController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ConversationStateMachine) private readonly fsm: ConversationStateMachine,
  ) {}

  /** T05 from the queue, T06 from the out-of-hours hold. */
  @Post('claim')
  @HttpCode(200)
  @Idempotent()
  claim(@Param('id', IdPipe) id: string) {
    return this.act(id, 'claim', (ctx) => ({ type: 'claim', userId: ctx.userId }));
  }

  /** T09: the agent waits for the customer's answer. */
  @Post('wait-customer')
  @HttpCode(200)
  @Idempotent()
  waitCustomer(@Param('id', IdPipe) id: string, @Body(VersionPipe) body: { version: number }) {
    return this.act(id, 'wait_customer', () => ({ type: 'agent_waits_customer' }), body.version);
  }

  private act(
    id: string,
    action: ConversationAction,
    event: (ctx: RequestContext) => ConversationEvent,
    version?: number,
  ) {
    const ctx = currentRequestContext();
    if (actionScope(ctx.role, action) === 'none') throw new ForbiddenException();
    return this.database.withTenant(ctx, async (tx) => {
      const before = await loadConversationView(tx, id);
      if (!before || (action !== 'claim' && !canSee(ctx.role, ctx.userId, before)))
        throw new ConversationNotFoundError();
      // The rights are decided on the version the client saw; the transition then checks nothing moved since.
      if (version !== undefined && version !== before.version) throw new VersionConflictError();
      if (!mayAct(ctx.role, ctx.userId, action, before)) throw new ForbiddenException();
      await this.fsm.transition(tx, id, event(ctx), {
        actor: { kind: 'agent', id: ctx.userId },
        traceId: ctx.traceId,
        ...(version === undefined ? {} : { expectedVersion: version }),
      });
      return loadConversationView(tx, id);
    });
  }
}
