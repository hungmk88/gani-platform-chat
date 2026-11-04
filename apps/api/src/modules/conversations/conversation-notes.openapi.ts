import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  ConversationNoteCreateSchema,
  ConversationNoteListQuerySchema,
  ConversationNotePageSchema,
  ConversationNoteSchema,
} from './conversation-notes.schemas.js';
import { ConversationIdSchema } from './conversations.schemas.js';

/** The internal notes of a conversation (C6, N194): served directly in openapi.json (CEO 04/11/2026, Tầng 2). */
export function registerConversationNotes(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const byId = { params: z.object({ id: ConversationIdSchema }) };
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  registry.registerPath({
    method: 'get',
    path: '/v1/conversations/{id}/notes',
    summary:
      'The internal notes of a conversation, newest first: whoever sees the conversation reads them (Sales and Support: their own and the unclaimed ones).',
    tags: ['conversations'],
    request: { ...byId, query: ConversationNoteListQuerySchema },
    responses: {
      200: { description: 'A page of notes.', ...json(ConversationNotePageSchema) },
      400: problemResponse('validation_failed: the id, the limit or the cursor.'),
      403: problemResponse('forbidden: marketing and viewer; or a refusal of the edge.'),
      404: problemResponse('not_found: no conversation the person sees with this id.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/conversations/{id}/notes',
    summary:
      'Write an internal note (audited `conversation.note_added {noteId, kind}`, never its words): Owner, Admin, Manager on any conversation they see, Sales and Support on one they hold; in every state. A note never changes.',
    tags: ['conversations'],
    request: {
      ...byId,
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(ConversationNoteCreateSchema) },
    },
    responses: {
      201: { description: 'The note.', ...json(ConversationNoteSchema) },
      400: problemResponse('validation_failed: the id, the body or the Idempotency-Key header.'),
      403: problemResponse(
        'forbidden: marketing and viewer, or Sales/Support on a conversation they do not hold; or a refusal of the edge.',
      ),
      404: problemResponse('not_found: no conversation the person sees with this id.'),
      409: problemResponse('idempotency_in_progress.'),
      422: problemResponse('idempotency_key_reused.'),
      ...edge,
    },
  });
}
