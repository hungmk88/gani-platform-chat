import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  ClaimConflictSchema,
  ConversationIdSchema,
  ConversationListQuerySchema,
  ConversationPageSchema,
  ConversationSchema,
  MessageListQuerySchema,
  MessagePageSchema,
  VersionBodySchema,
} from './conversations.schemas.js';

/** The paths of conversations.controller.ts in the OpenAPI document (Brief P18), from the same Zod schemas the controller validates with. */
export function registerConversations(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const errors = {
    ...EDGE_ERRORS,
    400: problemResponse('validation_failed: a parameter or the cursor is not valid.'),
    403: problemResponse(
      'forbidden (marketing, viewer), or a refusal of the edge (no_organisation, org_not_selected, two_factor_setup_required).',
    ),
  };
  const byId = { params: z.object({ id: ConversationIdSchema }) };
  registry.registerPath({
    method: 'get',
    path: '/v1/conversations',
    summary:
      'The Inbox: conversations of the session’s workspaces, most recent activity first. Sales and support see their own and the unclaimed ones (Phụ lục B, N133).',
    tags: ['conversations'],
    request: { query: ConversationListQuerySchema },
    responses: { 200: { description: 'A page.', ...json(ConversationPageSchema) }, ...errors },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/conversations/{id}',
    summary: 'One conversation. Not found and not visible are the same 404 (P9).',
    tags: ['conversations'],
    request: byId,
    responses: {
      200: { description: 'The conversation.', ...json(ConversationSchema) },
      404: problemResponse('not_found'),
      ...errors,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/conversations/{id}/messages',
    summary: 'The messages of a conversation, newest first; `nextCursor` pages back.',
    tags: ['conversations'],
    request: { ...byId, query: MessageListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(MessagePageSchema) },
      404: problemResponse('not_found'),
      ...errors,
    },
  });

  const action = {
    tags: ['conversations'],
    responses: {
      200: { description: 'The conversation after the action.', ...json(ConversationSchema) },
      400: problemResponse('validation_failed: the id, the body or the Idempotency-Key header.'),
      403: problemResponse(
        'forbidden: the role may not do this, or not on a conversation the person does not hold.',
      ),
      404: problemResponse('not_found'),
      409: problemResponse(
        'version_conflict (reload and try again), invalid_transition (not from this state), idempotency_in_progress.',
      ),
      422: problemResponse('idempotency_key_reused: the key was sent with another request.'),
      401: EDGE_ERRORS[401],
      503: EDGE_ERRORS[503],
    },
  };
  registry.registerPath({
    ...action,
    method: 'post',
    path: '/v1/conversations/{id}/claim',
    summary:
      'Claim a conversation of the queue or held out of hours (T05, T06). Exactly one of many claims at once wins.',
    request: { ...byId, headers: IdempotencyHeadersSchema },
    responses: {
      ...action.responses,
      409: {
        description:
          'conversation_already_claimed with assignedUserId (who holds it); invalid_transition; idempotency_in_progress.',
        content: { 'application/problem+json': { schema: ClaimConflictSchema } },
      },
    },
  });
  registry.registerPath({
    ...action,
    method: 'post',
    path: '/v1/conversations/{id}/wait-customer',
    summary:
      'Wait for the customer’s answer (T09). Sales and support: only a conversation they hold.',
    request: {
      ...byId,
      headers: IdempotencyHeadersSchema,
      body: { content: { 'application/json': { schema: VersionBodySchema } } },
    },
  });
}
