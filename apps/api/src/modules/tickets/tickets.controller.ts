import {
  changeTicket,
  createTicket,
  InvalidCursorError,
  listTickets,
  loadTicket,
  ticketNames,
  type TenantTx,
  type TicketChange,
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
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ValidationFailedError, ZodPipe } from '../../openapi/zod-pipe.js';
import { DatabaseService } from '../database/database.service.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { currentRequestContext, type RequestContext } from '../request-context/request-context.js';
import { httpErrorOf } from './tickets.errors.js';
import { mayChangeTickets, mayUseTickets, readsOwnTicketsOnly } from './tickets.permissions.js';
import {
  TicketChangeSchema,
  TicketCreateSchema,
  TicketIdSchema,
  TicketListQuerySchema,
  type TicketChangeBody,
  type TicketCreateBody,
  type TicketListQuery,
} from './tickets.schemas.js';
import { ticketEventView, ticketView } from './tickets.view.js';

/**
 * The tickets of the session's workspaces (K1c-1, U27, U52, U53, N170): Owner, Admin, Manager, Sales and Support read and make them,
 * a Sales reads only the ones they made; Marketing and Viewer are 403. Owner, Admin, Manager and Support change them (K1c-2). A
 * workspace the session does not belong to, or a ticket the person may not see, is a 404, as row-level security hides it.
 */
@Controller('v1/tickets')
export class TicketsController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async list(@Query(new ZodPipe(TicketListQuerySchema)) q: TicketListQuery) {
    const ctx = allowed(mayUseTickets, q.workspaceId);
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
    const ctx = allowed(mayUseTickets, body.workspaceId);
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
      throw httpErrorOf(error);
    }
  }

  /** One ticket with its events, oldest first. A ticket a Sales did not make is a 404, as one they cannot see (P9). */
  @Get(':id')
  async detail(@Param('id', new ZodPipe(TicketIdSchema)) id: string) {
    const ctx = allowed(mayUseTickets);
    const found = await this.database.withTenant(ctx, async (tx) => {
      const ticket = await loadTicket(tx, id);
      if (!ticket || (readsOwnTicketsOnly(ctx.role) && ticket.createdBy !== ctx.userId))
        return null;
      return { ticket, names: await ticketNames(tx, [ticket]) };
    });
    if (!found) throw new NotFoundException();
    return {
      ...ticketView(found.ticket, found.names),
      events: found.ticket.events.map(ticketEventView),
    };
  }

  /**
   * Change a ticket read at `version` (N167, U27, U52): the moves of N167 only, `cancelled` by an Owner, Admin or Manager, the
   * assignee a handler of the workspace; the store writes one event per kind of change. An empty description clears it.
   */
  @Patch(':id')
  async change(
    @Param('id', new ZodPipe(TicketIdSchema)) id: string,
    @Body(new ZodPipe(TicketChangeSchema)) body: TicketChangeBody,
  ) {
    const ctx = allowed(mayChangeTickets);
    try {
      return await this.database.withTenant(ctx, async (tx) => {
        const row = await changeTicket(tx, {
          id,
          version: body.version,
          change: changeOf(body),
          actorUserId: ctx.userId,
          actorRole: ctx.role,
          newId: uuidv7,
        });
        return ticketView(row, await ticketNames(tx, [row]));
      });
    } catch (error) {
      throw httpErrorOf(error);
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

/** The request context of a person whose role may do this, in `workspaceId` when one is named. */
function allowed(may: (role: RequestContext['role']) => boolean, workspaceId?: string) {
  const ctx = currentRequestContext();
  if (!may(ctx.role)) throw new ForbiddenException();
  if (workspaceId !== undefined && !ctx.workspaceIds.includes(workspaceId))
    throw new NotFoundException();
  return ctx;
}

/** The body as the store takes it, without the version; an empty description is none. */
function changeOf(body: TicketChangeBody): TicketChange {
  return {
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.description === undefined ? {} : { description: body.description || null }),
    ...(body.priority === undefined ? {} : { priority: body.priority }),
    ...(body.assigneeUserId === undefined ? {} : { assigneeUserId: body.assigneeUserId }),
  };
}
