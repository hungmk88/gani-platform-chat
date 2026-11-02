import {
  createTicket,
  InvalidCursorError,
  InvalidTicketAssigneeError,
  listTickets,
  TicketReferenceNotFoundError,
  ticketNames,
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
  Post,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { mayUseTickets, readsOwnTicketsOnly } from './tickets.permissions.js';
import {
  TicketCreateSchema,
  TicketListQuerySchema,
  type TicketCreateBody,
  type TicketListQuery,
} from './tickets.schemas.js';
import { TicketAssigneeHttpError, ticketView } from './tickets.view.js';

/**
 * The tickets of the session's workspaces (K1c-1, U27, U52, U53, N170): Owner, Admin, Manager, Sales and Support read and make them,
 * a Sales reads only the ones they made; Marketing and Viewer are 403. A workspace the session does not belong to is a 404, as
 * row-level security hides it. Changing a ticket and reading one by id are K1c-2.
 */
@Controller('v1/tickets')
export class TicketsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(TicketListQuerySchema)) q: TicketListQuery) {
    const ctx = allowed(q.workspaceId);
    const { page, names } = await this.read(ctx, async (tx) => {
      const found = await listTickets(tx, {
        limit: q.limit,
        ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
        ...(q.workspaceId === undefined ? {} : { workspaceId: q.workspaceId }),
        ...(q.status === undefined ? {} : { status: q.status }),
        ...(q.assignee === undefined
          ? {}
          : { assignee: q.assignee === 'me' ? ctx.userId : q.assignee }),
        ...(q.conversationId === undefined ? {} : { conversationId: q.conversationId }),
        ...(readsOwnTicketsOnly(ctx.role) ? { createdBy: ctx.userId } : {}),
      });
      return { page: found, names: await ticketNames(tx, found.rows) };
    });
    return { data: page.rows.map((row) => ticketView(row, names)), nextCursor: page.nextCursor };
  }

  /** Make a ticket in state `new`, with its `created` event. An empty description is no description. */
  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(@Body(new ZodPipe(TicketCreateSchema)) body: TicketCreateBody) {
    const ctx = allowed(body.workspaceId);
    try {
      return await this.database.withTenant(ctx, async (tx) => {
        const row = await createTicket(tx, {
          workspaceId: body.workspaceId,
          title: body.title,
          ...(body.description ? { description: body.description } : {}),
          priority: body.priority,
          ...(body.customerId === undefined ? {} : { customerId: body.customerId }),
          ...(body.conversationId === undefined ? {} : { conversationId: body.conversationId }),
          ...(body.assigneeUserId === undefined ? {} : { assigneeUserId: body.assigneeUserId }),
          createdBy: ctx.userId,
          newId: uuidv7,
        });
        return ticketView(row, await ticketNames(tx, [row]));
      });
    } catch (error) {
      if (error instanceof TicketReferenceNotFoundError) throw new NotFoundException();
      if (error instanceof InvalidTicketAssigneeError) throw new TicketAssigneeHttpError();
      throw error;
    }
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

/** The request context of a person whose role uses tickets, in `workspaceId` when one is named. */
function allowed(workspaceId?: string): RequestContext {
  const ctx = currentRequestContext();
  if (!mayUseTickets(ctx.role)) throw new ForbiddenException();
  if (workspaceId !== undefined && !ctx.workspaceIds.includes(workspaceId))
    throw new NotFoundException();
  return ctx;
}
