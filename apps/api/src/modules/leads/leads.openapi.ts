import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  EDGE_ERRORS,
  IdempotencyHeadersSchema,
  problemResponse,
  UuidSchema,
} from '../../openapi/schemas.js';
import { planned } from '../../openapi/planned-status.js';
import {
  LeadCloseSchema,
  LeadCreateSchema,
  LeadDetailSchema,
  LeadIdSchema,
  LeadListQuerySchema,
  LeadPageSchema,
  LeadSchema,
  LeadStageChangeSchema,
  PipelineSchema,
} from './leads.schemas.js';

// The leads and the pipeline (Brief P9 lines 443 and 464, U6, T-2, T-3, N188). Who may (Phụ lục B "Lead: tạo, đổi bước, Thắng/Thua",
// T-2): Owner, Admin, Manager everything; a Sales reads and writes only the leads they made or own (another one is a 404, as not
// visible); Marketing and Viewer read only; Support nothing (403). Another workspace or organisation is a 404.
const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
const tags = ['leads'];
const byId = { params: z.object({ id: LeadIdSchema }) };
const notFound = problemResponse(
  'not_found: no lead with this id in the session’s workspaces, or one a Sales neither made nor owns (not visible is the same).',
);
const readers = problemResponse('forbidden: support; or a refusal of the edge.');
const writers = problemResponse(
  'forbidden: support, marketing and viewer; or a refusal of the edge.',
);
const stale = 'version_conflict: the lead changed since it was read';
const closed = 'lead_closed: the lead is won or lost, which is final (T-3)';

/** Reading the pipeline and the leads (L4): served. */
export function registerLeadReads(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/v1/workspaces/{id}/pipeline',
    summary:
      'The steps of the workspace’s pipeline in order, and its reasons to lose a lead (Q9: data of each workspace). Every role that reads leads.',
    tags,
    request: { params: z.object({ id: UuidSchema }) },
    responses: {
      200: { description: 'The pipeline.', ...json(PipelineSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: readers,
      404: problemResponse('not_found: a workspace not among the session’s.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/leads',
    summary:
      'Leads of the session’s workspaces, newest first; filter by workspace, step, status, owner, maker and customer. A Sales sees the ones they made or own.',
    tags,
    request: { query: LeadListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(LeadPageSchema) },
      400: problemResponse('validation_failed: a parameter or the cursor.'),
      403: readers,
      404: problemResponse('not_found: a workspace not among the session’s.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/leads/{id}',
    summary: 'One lead with what happened to it (`events`, oldest first).',
    tags,
    request: byId,
    responses: {
      200: { description: 'The lead.', ...json(LeadDetailSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: readers,
      404: notFound,
      ...edge,
    },
  });
}

/** Making, moving and closing a lead (L5): planned for S4. */
export function registerLeadWrites(registry: OpenAPIRegistry): void {
  const when = planned('S4');
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/leads',
    summary:
      'Make a lead of a customer (Owner, Admin, Manager, Sales), status `open`, at the given step or the first one; owned by the given person or nobody.',
    tags,
    request: {
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(LeadCreateSchema) },
    },
    responses: {
      201: { description: 'The lead.', ...json(LeadSchema) },
      400: problemResponse('validation_failed: a field, or the Idempotency-Key is missing.'),
      403: writers,
      404: problemResponse('not_found: the workspace, customer or conversation is not visible.'),
      409: problemResponse('idempotency_in_progress: the same key is still running.'),
      422: problemResponse(
        'invalid_stage: not a step of the workspace’s pipeline; invalid_assignee: not an active Owner, Admin, Manager or Sales of the workspace; or idempotency_key_reused.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'patch',
    path: '/v1/leads/{id}/stage',
    summary:
      'Move an open lead to another step of its workspace’s pipeline (any step, either way). Winning or losing is `POST …/close`, not a step (U6).',
    tags,
    request: { ...byId, body: { required: true, ...json(LeadStageChangeSchema) } },
    responses: {
      200: { description: 'The lead after the move.', ...json(LeadSchema) },
      400: problemResponse('validation_failed: a field.'),
      403: writers,
      404: notFound,
      409: problemResponse(`${stale}; or ${closed}.`),
      422: problemResponse('invalid_stage: not a step of the workspace’s pipeline.'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/leads/{id}/close',
    summary:
      'Win or lose an open lead (U6, G3): `lostReason` is required when lost, one of the workspace’s reasons. Closing is final (T-3).',
    tags,
    request: { ...byId, body: { required: true, ...json(LeadCloseSchema) } },
    responses: {
      200: { description: 'The lead, closed.', ...json(LeadSchema) },
      400: problemResponse(
        'validation_failed: a field; `lostReason` missing when lost, or sent when won.',
      ),
      403: writers,
      404: notFound,
      409: problemResponse(`${stale}; or ${closed}.`),
      422: problemResponse('invalid_lost_reason: not one of the workspace’s reasons to lose.'),
      ...edge,
    },
  });
}
