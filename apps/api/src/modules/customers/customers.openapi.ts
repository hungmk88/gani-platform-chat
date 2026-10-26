import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
  CustomerChangeSchema,
  CustomerIdSchema,
  CustomerListQuerySchema,
  CustomerPageSchema,
  CustomerSchema,
} from './customers.schemas.js';

/** The paths of customers.controller.ts, for the Khách hàng screens and the Inbox (J1, N165). */
export function registerCustomers(registry: OpenAPIRegistry): void {
  const edge = { 401: EDGE_ERRORS[401], 403: EDGE_ERRORS[403], 503: EDGE_ERRORS[503] };
  registry.registerPath({
    method: 'get',
    path: '/v1/customers',
    summary:
      'The live customers of the organisation, newest first. `q` is a part of the name, the start of a phone number from 3 digits, or a whole email, any case, never a part of one (U48); Marketing and Viewer, who see phones and emails masked, search by name only.',
    tags: ['customers'],
    request: { query: CustomerListQuerySchema },
    responses: {
      200: {
        description: 'A page.',
        content: { 'application/json': { schema: CustomerPageSchema } },
      },
      400: problemResponse('validation_failed: the query or the cursor.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/customers/{id}',
    summary: 'One customer, with how the channels know them (N165).',
    tags: ['customers'],
    request: { params: z.object({ id: CustomerIdSchema }) },
    responses: {
      200: {
        description: 'The customer.',
        content: { 'application/json': { schema: CustomerSchema } },
      },
      400: problemResponse('validation_failed: the id.'),
      404: problemResponse('not_found: no live customer with this id in the organisation.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/customers/{id}',
    summary:
      'Change a profile (Owner to Support, Phụ lục B "Sửa hồ sơ khách"): name, phone (any usual way, stored in E.164), email, humanOnly; null clears. The audit names the fields, never their values.',
    tags: ['customers'],
    request: {
      params: z.object({ id: CustomerIdSchema }),
      body: { content: { 'application/json': { schema: CustomerChangeSchema } } },
    },
    responses: {
      200: {
        description: 'The customer after the change.',
        content: { 'application/json': { schema: CustomerSchema } },
      },
      400: problemResponse(
        'validation_failed: the id, an unknown or empty body, a phone that is not a whole number, an email.',
      ),
      404: problemResponse('not_found: no live customer with this id in the organisation.'),
      401: EDGE_ERRORS[401],
      403: problemResponse(
        'forbidden: Marketing and Viewer do not change profiles; or a refusal of the edge.',
      ),
      503: EDGE_ERRORS[503],
    },
  });
}
