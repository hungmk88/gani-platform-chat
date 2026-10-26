import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  QuickReplyChangeSchema,
  QuickReplyCreateSchema,
  QuickReplyIdSchema,
  QuickReplyListQuerySchema,
  QuickReplyListSchema,
  QuickReplyPreviewSchema,
  QuickReplySchema,
  QuickReplyUseSchema,
} from './quick-replies.schemas.js';

/** The paths of quick-replies.controller.ts, for the Inbox ("/") and /settings/quick-replies (C7, N163). */
export function registerQuickReplies(registry: OpenAPIRegistry): void {
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const writer = problemResponse(
    'forbidden: only an Owner, an Admin or a Manager manages templates (Phụ lục B); or a refusal of the edge.',
  );
  const noWorkspace = problemResponse('not_found: no workspace with this id among the session’s.');
  const noTemplate = problemResponse(
    'not_found: no live template with this id in the session’s workspaces.',
  );
  const one = (description: string) => ({
    description,
    content: { 'application/json': { schema: QuickReplySchema } },
  });
  const bodyRule =
    'validation_failed: a field (shortcut a-z 0-9 - _ up to 32; body up to 2000 with only {{customer_name}}, {{agent_name}}, {{company_name}}, {{company_phone}}; up to 10 different tags).';
  const params = z.object({ id: QuickReplyIdSchema });

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
  registry.registerPath({
    method: 'patch',
    path: '/v1/quick-replies/{id}',
    summary: 'Change the shortcut, the body or the tags of a template (N163).',
    tags: ['quick-replies'],
    request: {
      params,
      body: { content: { 'application/json': { schema: QuickReplyChangeSchema } } },
    },
    responses: {
      200: one('The template as it now is.'),
      400: problemResponse(`${bodyRule} Or nothing to change, or the id.`),
      403: writer,
      404: noTemplate,
      409: problemResponse(
        'duplicate_resource: another template of the workspace has this shortcut.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/quick-replies/{id}',
    summary: 'End a template; its shortcut is free again (N163).',
    tags: ['quick-replies'],
    request: { params },
    responses: {
      204: { description: 'Ended.' },
      400: problemResponse('validation_failed: the id.'),
      403: writer,
      404: noTemplate,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/quick-replies/{id}/used',
    summary:
      'Count one use of a template, called when the Inbox sends it (N163); most used come first in the list.',
    tags: ['quick-replies'],
    request: { params },
    responses: {
      200: {
        description: 'The count after this use.',
        content: { 'application/json': { schema: QuickReplyUseSchema } },
      },
      400: problemResponse('validation_failed: the id.'),
      403: problemResponse(
        'forbidden: a role that does not answer customers; or a refusal of the edge.',
      ),
      404: noTemplate,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/quick-replies/{id}/preview',
    summary:
      'The template with sample values (a sample customer, the caller’s name, the company’s name, the workspace’s contact number); the variables without one stay as written and are listed in `unresolved` (N163).',
    tags: ['quick-replies'],
    request: { params },
    responses: {
      200: {
        description: 'The preview.',
        content: { 'application/json': { schema: QuickReplyPreviewSchema } },
      },
      400: problemResponse('validation_failed: the id.'),
      403: writer,
      404: noTemplate,
      ...edge,
    },
  });
}
