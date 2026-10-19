import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
  ConversationIdSchema,
  ConversationListQuerySchema,
  ConversationPageSchema,
  ConversationSchema,
  MessageListQuerySchema,
  MessagePageSchema,
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
}
