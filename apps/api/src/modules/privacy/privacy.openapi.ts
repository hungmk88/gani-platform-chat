import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  PrivacyErasureSchema,
  PrivacyExportSchema,
  PrivacyRequestCreateSchema,
  PrivacyRequestIdSchema,
  PrivacyRequestListQuerySchema,
  PrivacyRequestPageSchema,
  PrivacyRequestSchema,
} from './privacy.schemas.js';

/** The paths of /v1/privacy-requests (P7, U35, N167): Owner and Admin only (Phụ lục B "Xử lý yêu cầu dữ liệu cá nhân"). */
export function registerPrivacy(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const tags = ['privacy'];
  const when = planned('S5');
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const forbidden = problemResponse(
    'forbidden: only an Owner or an Admin; or a refusal of the edge.',
  );
  const notFound = problemResponse('not_found: no such request in the organisation.');
  const byId = { params: z.object({ id: PrivacyRequestIdSchema }) };

  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/privacy-requests',
    summary: 'The requests of the organisation, newest first.',
    tags,
    request: { query: PrivacyRequestListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(PrivacyRequestPageSchema) },
      400: problemResponse('validation_failed: the cursor.'),
      403: forbidden,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/privacy-requests',
    summary:
      'Record a request (`export` or `erase`) for one customer, with its reason (audited: `privacy.requested`). Nothing is done yet: see /execute.',
    tags,
    request: {
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(PrivacyRequestCreateSchema) },
    },
    responses: {
      201: { description: 'The request, pending.', ...json(PrivacyRequestSchema) },
      400: problemResponse('validation_failed: a field, or the Idempotency-Key is missing.'),
      403: forbidden,
      404: problemResponse('not_found: no such customer in the organisation.'),
      409: problemResponse(
        'duplicate_resource: this customer already has a pending request of this kind; or idempotency_in_progress.',
      ),
      422: problemResponse('idempotency_key_reused'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/privacy-requests/{id}',
    summary: 'One request.',
    tags,
    request: byId,
    responses: {
      200: { description: 'The request.', ...json(PrivacyRequestSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: forbidden,
      404: notFound,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/privacy-requests/{id}/execute',
    summary:
      'Carry out a pending request in one transaction (audited: `privacy.executed`, ids and kind only). `export` answers the customer’s data as JSON (`PrivacyExport`, served as an attachment); `erase` removes the personal data for good and answers what it removed (`PrivacyErasure`).',
    tags,
    request: { ...byId, headers: IdempotencyHeadersSchema },
    responses: {
      200: {
        description: 'The export (kind `export`) or what was erased (kind `erase`).',
        content: {
          'application/json': { schema: z.union([PrivacyExportSchema, PrivacyErasureSchema]) },
        },
      },
      400: problemResponse('validation_failed: the id, or the Idempotency-Key is missing.'),
      403: forbidden,
      404: notFound,
      409: problemResponse(
        'request_not_pending: it was already executed; or idempotency_in_progress.',
      ),
      ...edge,
    },
  });
}
