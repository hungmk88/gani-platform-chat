import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  AccessSessionCreateSchema,
  AccessSessionIdSchema,
  AccessSessionListQuerySchema,
  AccessSessionPageSchema,
  AccessSessionRecordSchema,
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
  // U79 (CEO 05/11/2026): the operator's own sessions, and ending one early.
  const applying =
    'A session is applied with the header `X-Access-Session-Id: <id>` on each request into the organisation’s data. The header carries only the id of the session: the organisation is read from the stored session, never from the header (rule 1). The tenant middleware checks it on every request, whatever the controller: the session must be the caller’s (`operatorUserId` = the user of the session) and neither expired nor ended, else 403 `access_session_expired`. A session opens reading only: it gives no role in the organisation, and the second factor and every per-resource check still apply.';
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/platform/access-sessions',
    summary: 'The access sessions of the operator who calls, newest first (only their own).',
    description: applying,
    tags: ['platform'],
    request: { query: AccessSessionListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(AccessSessionPageSchema) },
      400: problemResponse('validation_failed: a parameter or the cursor.'),
      403: operatorOnly,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/platform/access-sessions/{id}/end',
    summary:
      'End a session early (audited: `platform.access_session_ended`). Only the operator who opened it; ending an ended session gives it back as it is.',
    description: applying,
    tags: ['platform'],
    request: { params: z.object({ id: AccessSessionIdSchema }) },
    responses: {
      200: {
        description: 'The session, ended (`endReason: manual`, or `expired` if it ran out first).',
        ...json(AccessSessionRecordSchema),
      },
      403: operatorOnly,
      404: problemResponse('not_found: no such session of the operator who calls.'),
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
