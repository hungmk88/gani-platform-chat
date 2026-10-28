import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  EDGE_ERRORS,
  IdempotencyHeadersSchema,
  ProblemSchema,
  problemResponse,
} from '../../openapi/schemas.js';
import {
  AssigneeBodySchema,
  AssigneeListSchema,
  AssigneesQuerySchema,
  ClaimConflictSchema,
  CloseBodySchema,
  ConversationIdSchema,
  ConversationListQuerySchema,
  ConversationPageSchema,
  ConversationSchema,
  InboxChannelListSchema,
  InboxChannelsQuerySchema,
  MessageListQuerySchema,
  MessagePageSchema,
  MessageSchema,
  SendMessageBodySchema,
  VersionBodySchema,
  WindowClosedSchema,
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
    path: '/v1/conversations/channels',
    summary:
      'The channels the Inbox filter offers (U56): the live channels at least one conversation the person may read came in by (Sales and support: their own and the unclaimed ones), by name. Never a channel of no such conversation, so no choice filters to nothing.',
    tags: ['conversations'],
    request: { query: InboxChannelsQuerySchema },
    responses: {
      200: { description: 'The channels.', ...json(InboxChannelListSchema) },
      ...errors,
    },
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
  registry.registerPath({
    method: 'get',
    path: '/v1/conversations/{id}/assignees',
    summary:
      'Who "Chuyển" (`purpose=transfer`) or "Gán lại" (`purpose=assign`) would accept (U31, N168): active members of the conversation’s workspace who may hold conversations, but not its holder; a Sales/Support transfer, only those who share a team with the caller. By name; `openCount` is for the whole organisation, `maxConcurrent` the effective limit.',
    tags: ['conversations'],
    request: { ...byId, query: AssigneesQuerySchema },
    responses: {
      200: { description: 'The people, by name (no name last).', ...json(AssigneeListSchema) },
      403: problemResponse(
        'forbidden: the role may not do this action (assign: sales, support; any: marketing, viewer), or a Sales/Support transfer of a conversation they do not hold; or a refusal of the edge.',
      ),
      400: problemResponse(
        'validation_failed: the id, or `purpose` missing or not transfer/assign.',
      ),
      404: problemResponse('not_found'),
      401: EDGE_ERRORS[401],
      503: EDGE_ERRORS[503],
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/conversations/{id}/messages',
    summary:
      'Answer the customer (N146): a text message of the agent, `pending` until the outbound worker sends it. Only while a person holds the conversation, and only inside the free window of the channel (channel-policy-spec §3). Sales and support: one they hold.',
    tags: ['conversations'],
    request: {
      ...byId,
      headers: IdempotencyHeadersSchema,
      body: { content: { 'application/json': { schema: SendMessageBodySchema } } },
    },
    responses: {
      201: { description: 'The message, with deliveryStatus pending.', ...json(MessageSchema) },
      400: problemResponse('validation_failed: the id, the text or the Idempotency-Key header.'),
      403: problemResponse(
        'forbidden: the role may not answer, or not a conversation the person does not hold.',
      ),
      404: problemResponse('not_found'),
      409: problemResponse(
        'conversation_not_active (claim it first, or it is closed); idempotency_in_progress.',
      ),
      422: {
        description:
          'channel_window_closed with windowState and reason: nothing was written (C-N4); unresolved_variable: the text still holds a {{…}} of a quick reply (N163); or idempotency_key_reused.',
        content: {
          'application/problem+json': { schema: z.union([WindowClosedSchema, ProblemSchema]) },
        },
      },
      401: EDGE_ERRORS[401],
      503: EDGE_ERRORS[503],
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
  const bodyOf = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const assignee = {
    ...action.responses,
    422: problemResponse(
      'invalid_assignee: not a member of the workspace who may hold conversations; idempotency_key_reused.',
    ),
  };
  for (const [path, summary, body, responses] of [
    [
      'transfer',
      'Hand the conversation to a colleague (T15). Sales and support: one they hold, to someone of a team they share. Audited.',
      AssigneeBodySchema,
      assignee,
    ],
    [
      'assign',
      'Give the conversation to someone, whoever holds it or from the queue (T16, T21). Owner, admin, manager. Audited.',
      AssigneeBodySchema,
      assignee,
    ],
    [
      'close',
      'Close with the outcome of the conversation (T13). Sales and support: one they hold.',
      CloseBodySchema,
      action.responses,
    ],
  ] as const)
    registry.registerPath({
      ...action,
      method: 'post',
      path: `/v1/conversations/{id}/${path}`,
      summary,
      request: { ...byId, headers: IdempotencyHeadersSchema, body: bodyOf(body) },
      responses,
    });
}
