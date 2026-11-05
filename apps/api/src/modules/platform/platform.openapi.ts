import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  AccessSessionCreateSchema,
  AccessSessionSchema,
  ChannelPolicyChangeSchema,
  ChannelPolicyIdSchema,
  ChannelPolicyListSchema,
  ChannelPolicySchema,
  TenantHealthPageSchema,
  TenantHealthQuerySchema,
} from './platform.schemas.js';

/**
 * The paths of the Platform screen #30 (U65, CEO 05/11/2026; Brief P9 lines 447, 473), built in S5. The health and the access sessions
 * are for a platform operator only (30 a minute); the channel policies are read by every role and changed by a platform operator only.
 */
export function registerPlatform(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const when = planned('S5');
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const operatorOnly = problemResponse('forbidden: only a platform operator.');

  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/platform/tenants/health',
    summary:
      'The health of every organisation: its channel accounts and their Zalo tokens, and its AI spend (null until the AI Gateway).',
    tags: ['platform'],
    request: { query: TenantHealthQuerySchema },
    responses: {
      200: { description: 'A page, by organisation slug.', ...json(TenantHealthPageSchema) },
      400: problemResponse('validation_failed: a parameter or the cursor.'),
      403: operatorOnly,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/platform/access-sessions',
    summary:
      'Open a 60 minute access to one organisation, with a reason: one row of platform_access_logs (reason, expires_at) and an audit row, so the access is seen once.',
    tags: ['platform'],
    request: {
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(AccessSessionCreateSchema) },
    },
    responses: {
      201: { description: 'The session, open for 60 minutes.', ...json(AccessSessionSchema) },
      400: problemResponse(
        'validation_failed: the reason (10 to 500 characters), or the Idempotency-Key is missing.',
      ),
      403: operatorOnly,
      404: problemResponse('not_found: no such organisation.'),
      409: problemResponse('idempotency_in_progress'),
      422: problemResponse('idempotency_key_reused'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/channel-policies',
    summary:
      'The channel policies in force now, one per channel and class (every role reads them).',
    tags: ['channel-policies'],
    responses: {
      200: { description: 'The policies in force.', ...json(ChannelPolicyListSchema) },
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'put',
    path: '/v1/channel-policies/{id}',
    summary:
      'Add a new version of the policy `{id}` (its channel and class) from `effectiveFrom`; no row is ever edited (audited: `channel_policy.versioned`).',
    tags: ['channel-policies'],
    request: {
      params: z.object({ id: ChannelPolicyIdSchema }),
      body: { required: true, ...json(ChannelPolicyChangeSchema) },
    },
    responses: {
      200: {
        description:
          'The latest version in force of that channel and class after the change (the previous one while a future effectiveFrom is not reached).',
        ...json(ChannelPolicySchema),
      },
      400: problemResponse('validation_failed: a field.'),
      403: operatorOnly,
      404: problemResponse('not_found: no such policy.'),
      422: problemResponse(
        'invalid_effective_from: not later than the effectiveFrom of the version in force.',
      ),
      ...edge,
    },
  });
}
