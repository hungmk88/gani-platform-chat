import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  BotFlowCreateSchema,
  BotFlowDetailSchema,
  BotFlowIdSchema,
  BotFlowListQuerySchema,
  BotFlowListSchema,
} from './bot-flows.schemas.js';

/** The paths of bot-flows.controller.ts, for #17 (list of flows) and #18 (the builder), U63. */
export function registerBotFlows(registry: OpenAPIRegistry): void {
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const builder = problemResponse(
    'forbidden: only an Owner, an Admin or a Manager builds and reads bot flows (Phụ lục B); or a refusal of the edge.',
  );
  const json = <T extends z.ZodType>(description: string, schema: T) => ({
    description,
    content: { 'application/json': { schema } },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/bot-flows',
    summary: 'The live bot flows of a workspace, last changed first (at most 200).',
    tags: ['bot-flows'],
    request: { query: BotFlowListQuerySchema },
    responses: {
      200: json('The flows.', BotFlowListSchema),
      400: problemResponse('validation_failed: the query.'),
      403: builder,
      404: problemResponse('not_found: no workspace with this id among the session’s.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/bot-flows',
    summary:
      'Make a flow in a workspace, with an empty draft (not publishable until a graph is saved).',
    tags: ['bot-flows'],
    request: {
      headers: IdempotencyHeadersSchema,
      body: { content: { 'application/json': { schema: BotFlowCreateSchema } } },
    },
    responses: {
      201: json('The flow, its empty draft, no published version.', BotFlowDetailSchema),
      400: problemResponse(
        'validation_failed: a field (name 1–100); or the Idempotency-Key header.',
      ),
      403: builder,
      404: problemResponse('not_found: no workspace with this id among the session’s.'),
      409: problemResponse('idempotency_in_progress.'),
      422: problemResponse('idempotency_key_reused: the same key with another request.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/bot-flows/{id}',
    summary: 'A flow with the graph of its draft and of its latest published version.',
    tags: ['bot-flows'],
    request: { params: z.object({ id: BotFlowIdSchema }) },
    responses: {
      200: json('The flow.', BotFlowDetailSchema),
      400: problemResponse('validation_failed: the id.'),
      403: builder,
      404: problemResponse('not_found: no live flow with this id in the session’s workspaces.'),
      ...edge,
    },
  });
}
