import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  BotFlowCreateSchema,
  BotFlowDetailSchema,
  BotFlowIdSchema,
  BotFlowListQuerySchema,
  BotFlowListSchema,
  BotGraphSchema,
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
  const params = z.object({ id: BotFlowIdSchema });
  const noFlow = problemResponse(
    'not_found: no live flow with this id in the session’s workspaces.',
  );
  const graphInvalid = problemResponse(
    'bot_flow_graph_invalid: the graph cannot run; the detail names the rule (trigger_count: not exactly one trigger, duplicate_key, unknown_node: an edge to or from no node, unreachable_node: a node the trigger never reaches).',
  );
  registry.registerPath({
    method: 'put',
    path: '/v1/bot-flows/{id}/draft',
    summary:
      'Save the whole graph as the new draft; the old draft is kept, given up (never deleted). A node of type ai_answer is a 400 (Đợt 2).',
    tags: ['bot-flows'],
    request: { params, body: { content: { 'application/json': { schema: BotGraphSchema } } } },
    responses: {
      200: json('The flow with its new draft.', BotFlowDetailSchema),
      400: problemResponse(
        'validation_failed: the id, or the graph (a node type outside Đợt 1, a config field missing or unknown, a key outside A-Z a-z 0-9 _ -, more than 200 nodes or 400 edges).',
      ),
      403: builder,
      404: noFlow,
      422: graphInvalid,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/bot-flows/{id}/versions',
    summary:
      'Publish the draft as the next version (audited: `bot_flow.published {version}`); a new draft copies it and the flow is active.',
    tags: ['bot-flows'],
    request: { params, headers: IdempotencyHeadersSchema },
    responses: {
      201: json('The flow with its new published version and new draft.', BotFlowDetailSchema),
      400: problemResponse('validation_failed: the id; or the Idempotency-Key header.'),
      403: builder,
      404: noFlow,
      409: problemResponse('idempotency_in_progress.'),
      422: problemResponse(
        'bot_flow_graph_invalid: the draft cannot run (an empty draft: trigger_count); or idempotency_key_reused.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/bot-flows/{id}',
    summary: 'Delete a flow (soft, audited: `bot_flow.deleted`); its versions are kept, frozen.',
    tags: ['bot-flows'],
    request: { params },
    responses: {
      204: { description: 'Deleted.' },
      400: problemResponse('validation_failed: the id.'),
      403: builder,
      404: noFlow,
      ...edge,
    },
  });
}
