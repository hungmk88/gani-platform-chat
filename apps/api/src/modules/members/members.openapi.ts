import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  InvitationSchema,
  InviteBodySchema,
  MemberIdSchema,
  MemberListQuerySchema,
  MemberPageSchema,
  MemberSchema,
  RoleBodySchema,
} from './members.schemas.js';

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
    method: 'get',
    path: '/v1/members',
    summary:
      'The members of the organisation and its pending invitations, with their email, oldest first (#19, N153). Owner and Admin only.',
    tags: ['members'],
    request: { query: MemberListQuerySchema },
    responses: {
      200: {
        description: 'A page.',
        content: { 'application/json': { schema: MemberPageSchema } },
      },
      400: problemResponse('validation_failed: the cursor or the limit.'),
      401: EDGE_ERRORS[401],
      403: problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.'),
      503: EDGE_ERRORS[503],
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/members/{id}/role',
    summary:
      'Change the role of a member (N154). Owner: any role of anyone but themselves; Admin: never to or from Owner. The organisation always keeps an active Owner.',
    tags: ['members'],
    request: {
      params: z.object({ id: MemberIdSchema }),
      body: { content: { 'application/json': { schema: RoleBodySchema } } },
    },
    responses: {
      200: {
        description: 'The member, in the new role.',
        content: { 'application/json': { schema: MemberSchema } },
      },
      400: problemResponse('validation_failed: the id or the role.'),
      401: EDGE_ERRORS[401],
      403: problemResponse(
        'forbidden: not an Owner or an Admin, their own role, or an Admin and an Owner (Phụ lục B); or a refusal of the edge.',
      ),
      404: problemResponse(
        'not_found: no member with this id in the organisation (an invitation is not a member yet).',
      ),
      409: problemResponse('last_owner: the organisation would be left without an active Owner.'),
      503: EDGE_ERRORS[503],
    },
  });
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
