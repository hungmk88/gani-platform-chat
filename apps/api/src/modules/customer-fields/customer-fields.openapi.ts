import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse, UuidSchema } from '../../openapi/schemas.js';
import { planned } from '../../openapi/planned-status.js';
import {
  CustomerFieldChangeSchema,
  CustomerFieldCreateSchema,
  CustomerFieldIdSchema,
  CustomerFieldListSchema,
  CustomerFieldSchema,
  CustomerFieldValuesChangeSchema,
  CustomerFieldValuesSchema,
} from './customer-fields.schemas.js';

/**
 * The custom fields (J1, T-1(a), T-5/U46, U36, CEO 02/11 decision 4 and answers 1 and 4): their definitions, served since Tag 3b-ii,
 * the contract planned for S4 moved as it was. Every role reads the fields; only an Owner or an Admin defines them (audited).
 */
export function registerCustomerFields(registry: OpenAPIRegistry): void {
  const { json, edge, tags } = shared();
  const byId = { params: z.object({ id: CustomerFieldIdSchema }) };
  const admins = problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.');
  const notFound = problemResponse('not_found: no field with this id in the company.');
  const hasData = 'field_has_data: some customer has a value';

  registry.registerPath({
    method: 'get',
    path: '/v1/customer-fields',
    summary: 'Every custom field of the company, by position, hidden ones too.',
    tags,
    responses: { 200: { description: 'The fields.', ...json(CustomerFieldListSchema) }, ...edge },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/customer-fields',
    summary:
      'Define a field (Owner, Admin; audited `customer_field.created`): at most 50 a company; `select` and `multiselect` need two choices or more.',
    tags,
    request: { body: { required: true, ...json(CustomerFieldCreateSchema) } },
    responses: {
      201: { description: 'The field.', ...json(CustomerFieldSchema) },
      400: problemResponse('validation_failed: a field, or options missing or not wanted.'),
      403: admins,
      422: problemResponse('field_limit_reached: the company has 50 fields already.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/customer-fields/{id}',
    summary:
      'Change a field (Owner, Admin; audited `customer_field.updated`): name, choices, required, hidden, position; `type` and `sensitive` only while no customer has a value.',
    tags,
    request: { ...byId, body: { required: true, ...json(CustomerFieldChangeSchema) } },
    responses: {
      200: { description: 'The field after the change.', ...json(CustomerFieldSchema) },
      400: problemResponse('validation_failed: a field, or nothing to change.'),
      403: admins,
      404: notFound,
      409: problemResponse(
        `${hasData}: \`type\` or \`sensitive\` changed, or a choice in use removed.`,
      ),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/customer-fields/{id}',
    summary:
      'Delete a field no customer has a value for (Owner, Admin; audited `customer_field.deleted`); otherwise hide it.',
    tags,
    request: byId,
    responses: {
      204: { description: 'Deleted.' },
      403: admins,
      404: notFound,
      409: problemResponse(`${hasData}: hide the field instead.`),
      ...edge,
    },
  });
}

/**
 * A customer's values of the custom fields, still planned for S4 (Tag 3b-iii builds them). They follow "Sửa hồ sơ khách": Owner,
 * Admin, Manager, Sales, Support write; Marketing and Viewer read, a sensitive value masked by the API.
 */
export function registerCustomerFieldValues(registry: OpenAPIRegistry): void {
  const { json, edge, tags } = shared();
  const when = planned('S4');
  const customer = { params: z.object({ id: UuidSchema }) };
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/customers/{id}/fields',
    summary:
      'A customer’s values (every role); a sensitive value is `"••••"` for Marketing and Viewer, masked by the API (P8).',
    tags,
    request: customer,
    responses: {
      200: { description: 'The values.', ...json(CustomerFieldValuesSchema) },
      400: problemResponse('validation_failed: the id.'),
      404: problemResponse('not_found: no customer with this id in the company.'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'put',
    path: '/v1/customers/{id}/fields',
    summary:
      'Set some of a customer’s values (Owner, Admin, Manager, Sales, Support): only the fields sent change, `null` clears one.',
    tags,
    request: { ...customer, body: { required: true, ...json(CustomerFieldValuesChangeSchema) } },
    responses: {
      200: {
        description: 'All the customer’s values after the change.',
        ...json(CustomerFieldValuesSchema),
      },
      400: problemResponse('validation_failed: a field, or a field twice.'),
      403: problemResponse('forbidden: marketing and viewer; or a refusal of the edge.'),
      404: problemResponse('not_found: the customer, or a field, is not of the company.'),
      422: problemResponse(
        'invalid_field_value: a value of the wrong type, or not one of the choices.',
      ),
      ...edge,
    },
  });
}

function shared() {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  return { json, edge, tags: ['customer-fields'] };
}
