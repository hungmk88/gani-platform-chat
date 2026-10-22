import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import { InvitationSchema, InviteBodySchema, MemberIdSchema } from './members.schemas.js';

/** The paths of members.controller.ts in the OpenAPI document, for the screen /settings/members (N152). */
export function registerMembers(registry: OpenAPIRegistry): void {
  const answer = (description: string) => ({
    description,
    content: { 'application/json': { schema: InvitationSchema } },
  });
  const shared = {
    401: EDGE_ERRORS[401],
    403: problemResponse(
      'forbidden: only an Owner or an Admin invites, and an Admin never as Owner (Phụ lục B); or a refusal of the edge.',
    ),
    422: problemResponse('idempotency_key_reused: the same key with another request.'),
    503: EDGE_ERRORS[503],
  };
  registry.registerPath({
    method: 'post',
    path: '/v1/members/invite',
    summary:
      'Invite a person to the organisation of the session by email, as a role. The email holds a link valid 7 days, once (N152).',
    tags: ['members'],
    request: {
      headers: IdempotencyHeadersSchema,
      body: { content: { 'application/json': { schema: InviteBodySchema } } },
    },
    responses: {
      201: answer('The pending invitation.'),
      400: problemResponse('validation_failed: the email, the role or the Idempotency-Key header.'),
      409: problemResponse(
        'duplicate_resource: this email has a pending invitation (use resend-invite); idempotency_in_progress.',
      ),
      ...shared,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/members/{id}/resend-invite',
    summary:
      'Send a pending invitation again: a new link and 7 more days; the link sent before stops working.',
    tags: ['members'],
    request: { params: z.object({ id: MemberIdSchema }), headers: IdempotencyHeadersSchema },
    responses: {
      200: answer('The invitation, renewed.'),
      400: problemResponse('validation_failed: the id or the Idempotency-Key header.'),
      404: problemResponse('not_found: no pending invitation with this id in the organisation.'),
      409: problemResponse('idempotency_in_progress'),
      ...shared,
    },
  });
}
