import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import { planned } from '../../openapi/planned-status.js';
import {
  TicketChangeSchema,
  TicketCreateSchema,
  TicketDetailSchema,
  TicketIdSchema,
  TicketListQuerySchema,
  TicketPageSchema,
  TicketSchema,
} from './tickets.schemas.js';

/** The paths of /v1/tickets (U27, Brief P9 "GET/POST/PATCH /v1/tickets"), planned for S4. */
export function registerTickets(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const notFound = problemResponse(
    'not_found: no ticket with this id in the session’s workspaces (not visible is the same).',
  );
  const forbidden = problemResponse(
    'forbidden: marketing and viewer; sales reads only the tickets they made; or a refusal of the edge.',
  );
  const byId = { params: z.object({ id: TicketIdSchema }) };
  const tags = ['tickets'];
  const when = planned('S4');

  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/tickets',
    summary:
      'Tickets of the session’s workspaces, newest first; filter by workspace, status and assignee. Sales see the ones they made.',
    tags,
    request: { query: TicketListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(TicketPageSchema) },
      400: problemResponse('validation_failed: a parameter or the cursor.'),
      403: forbidden,
      404: problemResponse('not_found: a workspace not among the session’s.'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/tickets',
    summary:
      'Make a ticket (Owner, Admin, Manager, Sales, Support: Phụ lục B "Ticket: tạo"), status `new`, from a conversation or not.',
    tags,
    request: {
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(TicketCreateSchema) },
    },
    responses: {
      201: { description: 'The ticket.', ...json(TicketSchema) },
      400: problemResponse('validation_failed: a field, or the Idempotency-Key is missing.'),
      403: forbidden,
      404: problemResponse('not_found: the workspace, customer or conversation is not visible.'),
      409: problemResponse('idempotency_in_progress: the same key is still running.'),
      422: problemResponse(
        'invalid_assignee: not a member of the workspace who handles tickets; or idempotency_key_reused.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/tickets/{id}',
    summary: 'One ticket with what happened to it (`events`, oldest first).',
    tags,
    request: byId,
    responses: {
      200: { description: 'The ticket.', ...json(TicketDetailSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: forbidden,
      404: notFound,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'patch',
    path: '/v1/tickets/{id}',
    summary:
      'Change a ticket (Owner, Admin, Manager, Support). `status` follows new → in_progress → waiting_customer ⇄ in_progress → done (reopen: done → in_progress); `cancelled` from any open state, Owner/Admin/Manager only, and final. Waiting for the customer stops the SLA clock (U27).',
    tags,
    request: { ...byId, body: { required: true, ...json(TicketChangeSchema) } },
    responses: {
      200: { description: 'The ticket after the change.', ...json(TicketSchema) },
      400: problemResponse('validation_failed: a field, or nothing to change.'),
      403: problemResponse(
        'forbidden: sales, marketing, viewer; `cancelled` asked by support; or a refusal of the edge.',
      ),
      404: notFound,
      409: problemResponse(
        'version_conflict: the ticket changed since it was read; or invalid_transition: this status cannot follow the current one.',
      ),
      422: problemResponse('invalid_assignee: not a member of the workspace who handles tickets.'),
      ...edge,
    },
  });
}
