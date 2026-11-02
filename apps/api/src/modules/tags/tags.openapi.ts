import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse, UuidSchema } from '../../openapi/schemas.js';
import {
  CustomerTagsChangeSchema,
  CustomerTagsSchema,
  TagChangeSchema,
  TagCreateSchema,
  TagIdSchema,
  TagListSchema,
  TagMergeResultSchema,
  TagMergeSchema,
  TagSchema,
} from './tags.schemas.js';

/**
 * The tags (J4, T-1(a), T-4, U36, CEO 02/11 decision 4 and answers 1–3; served since Tag 3a). Every role reads them; only an Owner
 * or an Admin makes, renames, hides or merges one (Brief Backend and the CEO over Phụ lục B's Manager).
 */
export function registerTags(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const tags = ['tags'];
  const byId = { params: z.object({ id: TagIdSchema }) };
  const admins = problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.');
  const notFound = problemResponse('not_found: no tag with this id in the company.');
  const taken = problemResponse(
    'duplicate_resource: another tag of the company has this name (case aside).',
  );

  registry.registerPath({
    method: 'get',
    path: '/v1/tags',
    summary:
      'Every tag of the company, by name, hidden ones too, with how many customers have each.',
    tags,
    responses: { 200: { description: 'The tags.', ...json(TagListSchema) }, ...edge },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/tags',
    summary: 'Make a tag (Owner, Admin): at most 500 a company.',
    tags,
    request: { body: { required: true, ...json(TagCreateSchema) } },
    responses: {
      201: { description: 'The tag.', ...json(TagSchema) },
      400: problemResponse('validation_failed: the name (1–50 characters).'),
      403: admins,
      409: taken,
      422: problemResponse('tag_limit_reached: the company has 500 tags already.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/tags/{id}',
    summary:
      'Rename or hide a tag (Owner, Admin). Hidden: no customer gets it any more, those who have it keep it, it still filters (T-4).',
    tags,
    request: { ...byId, body: { required: true, ...json(TagChangeSchema) } },
    responses: {
      200: { description: 'The tag after the change.', ...json(TagSchema) },
      400: problemResponse('validation_failed: a field, or nothing to change.'),
      403: admins,
      404: notFound,
      409: taken,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/tags/{id}/merge',
    summary:
      'Merge this tag into `intoTagId` in one transaction (Owner, Admin; audited `tag.merged`): its customers get the other tag, none is lost, then this tag is gone. The tag that stays keeps its name and hidden flag.',
    tags,
    request: { ...byId, body: { required: true, ...json(TagMergeSchema) } },
    responses: {
      200: { description: 'What moved.', ...json(TagMergeResultSchema) },
      400: problemResponse('validation_failed: a field, or a tag merged into itself.'),
      403: admins,
      404: problemResponse('not_found: either tag is not of the company.'),
      ...edge,
    },
  });
}

/**
 * Setting a customer's tags follows "Sửa hồ sơ khách": Owner, Admin, Manager, Sales, Support, existing tags only; Marketing and Viewer
 * 403 (served since Tag 3a-iii).
 */
export function registerCustomerTags(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const tags = ['tags'];
  registry.registerPath({
    method: 'put',
    path: '/v1/customers/{id}/tags',
    summary:
      'Set the whole set of a customer’s tags (Owner, Admin, Manager, Sales, Support; existing tags only). A hidden tag the customer has stays; a hidden tag added is refused.',
    tags,
    request: {
      params: z.object({ id: UuidSchema }),
      body: { required: true, ...json(CustomerTagsChangeSchema) },
    },
    responses: {
      200: { description: 'The customer’s tags, by name.', ...json(CustomerTagsSchema) },
      400: problemResponse('validation_failed: a field, or a tag twice.'),
      403: problemResponse('forbidden: marketing and viewer; or a refusal of the edge.'),
      404: problemResponse('not_found: the customer, or a tag, is not of the company.'),
      422: problemResponse('tag_hidden: a hidden tag the customer does not have yet.'),
      ...edge,
    },
  });
}
