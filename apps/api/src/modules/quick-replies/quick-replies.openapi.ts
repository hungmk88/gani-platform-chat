import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  QuickReplyCreateSchema,
  QuickReplyListQuerySchema,
  QuickReplyListSchema,
  QuickReplySchema,
} from './quick-replies.schemas.js';

/** The paths of quick-replies.controller.ts, for the Inbox ("/") and /settings/quick-replies (C7, N163). */
export function registerQuickReplies(registry: OpenAPIRegistry): void {
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const writer = problemResponse(
    'forbidden: only an Owner, an Admin or a Manager manages templates (Phụ lục B); or a refusal of the edge.',
  );
  const noWorkspace = problemResponse('not_found: no workspace with this id among the session’s.');
  const one = (description: string) => ({
    description,
    content: { 'application/json': { schema: QuickReplySchema } },
  });
  const bodyRule =
    'validation_failed: a field (shortcut a-z 0-9 - _ up to 32; body up to 2000 with only {{customer_name}}, {{agent_name}}, {{company_name}}, {{company_phone}}; up to 10 different tags).';

  registry.registerPath({
    method: 'get',
    path: '/v1/quick-replies',
    summary:
      'The live templates of a workspace, most used first; `q` is the start of a shortcut, `tag` one of its tags (N163).',
    tags: ['quick-replies'],
    request: { query: QuickReplyListQuerySchema },
    responses: {
      200: {
        description: 'The templates.',
        content: { 'application/json': { schema: QuickReplyListSchema } },
      },
      400: problemResponse('validation_failed: the query.'),
      403: problemResponse(
        'forbidden: a role that does not answer customers; or a refusal of the edge.',
      ),
      404: noWorkspace,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/quick-replies',
    summary: 'Make a template in a workspace (N163).',
    tags: ['quick-replies'],
    request: {
      headers: IdempotencyHeadersSchema,
      body: { content: { 'application/json': { schema: QuickReplyCreateSchema } } },
    },
    responses: {
      201: one('The template.'),
      400: problemResponse(`${bodyRule} Or the Idempotency-Key header.`),
      403: writer,
      404: noWorkspace,
      409: problemResponse(
        'duplicate_resource: another template of the workspace has this shortcut; idempotency_in_progress.',
      ),
      422: problemResponse('idempotency_key_reused: the same key with another request.'),
      ...edge,
    },
  });
}
