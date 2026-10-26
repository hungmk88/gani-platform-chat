import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
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
      'The live customers of the organisation, newest first. `q` is a part of the name, or the start of a phone number from 3 digits (not for Marketing and Viewer, who see phones and emails masked).',
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
}
