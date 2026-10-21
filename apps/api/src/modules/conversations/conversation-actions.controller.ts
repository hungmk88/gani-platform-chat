import {
  insertAuditLog,
  loadConversationView,
  readMemberContext,
  shareTeam,
  type ConversationView,
  type TenantTx,
} from '@gani/db';
import { uuidv7, type ConversationEvent } from '@gani/domain';
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
import {
  AssigneeBodySchema,
  CloseBodySchema,
  ConversationIdSchema,
  VersionBodySchema,
} from './conversations.schemas.js';
import { ConversationNotFoundError, InvalidAssigneeError, VersionConflictError } from './errors.js';
import { actionScope, canSee, mayAct, type ConversationAction } from './permissions.js';

const IdPipe = new ZodPipe(ConversationIdSchema);
type Assignee = { version: number; toUserId: string };
type Close = { version: number; outcome: 'resolved' | 'no_response' | 'spam' };
type Step = (tx: TenantTx, ctx: RequestContext, conversation: ConversationView) => Promise<unknown>;

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
  waitCustomer(
    @Param('id', IdPipe) id: string,
    @Body(new ZodPipe(VersionBodySchema)) body: { version: number },
  ) {
    return this.act(id, 'wait_customer', () => ({ type: 'agent_waits_customer' }), body);
  }

  /** T15: the holder hands it to a colleague of one of their teams; a manager to anyone of the workspace. Audited. */
  @Post('transfer')
  @HttpCode(200)
  @Idempotent()
  transfer(@Param('id', IdPipe) id: string, @Body(new ZodPipe(AssigneeBodySchema)) body: Assignee) {
    return this.act(id, 'transfer', () => ({ type: 'transfer', toUserId: body.toUserId }), {
      ...body,
      check: (tx, ctx, c) =>
        handOver(tx, ctx, c, body.toUserId, actionScope(ctx.role, 'transfer') === 'own'),
      after: audit('conversation.transferred', body.toUserId),
    });
  }

  /** T16 (someone holds it) or T21 (it waits in the queue): a manager gives it to someone. Audited. */
  @Post('assign')
  @HttpCode(200)
  @Idempotent()
  assign(@Param('id', IdPipe) id: string, @Body(new ZodPipe(AssigneeBodySchema)) body: Assignee) {
    return this.act(id, 'assign', () => ({ type: 'reassign', toUserId: body.toUserId }), {
      ...body,
      check: (tx, ctx, c) => handOver(tx, ctx, c, body.toUserId, false),
      after: audit('conversation.reassigned', body.toUserId),
    });
  }

  /** T13 with the outcome of the conversation (resolved, no_response, spam). */
  @Post('close')
  @HttpCode(200)
  @Idempotent()
  close(@Param('id', IdPipe) id: string, @Body(new ZodPipe(CloseBodySchema)) body: Close) {
    return this.act(
      id,
      'close',
      () => ({ type: 'close', now: new Date(), outcome: body.outcome }),
      body,
    );
  }

  private act(
    id: string,
    action: ConversationAction,
    event: (ctx: RequestContext) => ConversationEvent,
    o: { version?: number; check?: Step; after?: Step } = {},
  ) {
    const ctx = currentRequestContext();
    if (actionScope(ctx.role, action) === 'none') throw new ForbiddenException();
    return this.database.withTenant(ctx, async (tx) => {
      const before = await loadConversationView(tx, id);
      if (!before || (action !== 'claim' && !canSee(ctx.role, ctx.userId, before)))
        throw new ConversationNotFoundError();
      // The rights are decided on the version the client saw; the transition then checks nothing moved since.
      if (o.version !== undefined && o.version !== before.version) throw new VersionConflictError();
      if (!mayAct(ctx.role, ctx.userId, action, before)) throw new ForbiddenException();
      await o.check?.(tx, ctx, before);
      await this.fsm.transition(tx, id, event(ctx), {
        actor: { kind: 'agent', id: ctx.userId },
        traceId: ctx.traceId,
        ...(o.version === undefined ? {} : { expectedVersion: o.version }),
      });
      await o.after?.(tx, ctx, before);
      return loadConversationView(tx, id);
    });
  }
}

/**
 * Who may take the conversation: an active member of its workspace whose role may hold conversations, and not the one who holds it.
 * Sales and support hand over within a team they share (Phụ lục B "Team"); that is checked first, so they cannot learn who is a member.
 */
async function handOver(
  tx: TenantTx,
  ctx: RequestContext,
  c: ConversationView,
  to: string,
  sameTeam: boolean,
) {
  if (sameTeam && !(await shareTeam(tx, ctx.userId, to))) throw new ForbiddenException();
  const member = await readMemberContext(tx, to);
  if (
    !member ||
    !member.workspaceIds.includes(c.workspaceId) ||
    actionScope(member.role, 'claim') === 'none'
  )
    throw new InvalidAssigneeError();
  if (to === c.assignedUserId) throw new InvalidAssigneeError();
}

/** An audit row in the same transaction as the transition (P9: transfer and assign are audited). Ids only, no PII. */
const audit =
  (action: string, toUserId: string): Step =>
  (tx, ctx, c) =>
    insertAuditLog(tx, {
      id: uuidv7(),
      actorUserId: ctx.userId,
      action,
      targetType: 'conversation',
      targetId: c.id,
      detail: { fromUserId: c.assignedUserId, toUserId, version: c.version + 1 },
    });
