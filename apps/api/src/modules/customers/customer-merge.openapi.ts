import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  CustomerMergeListSchema,
  CustomerMergeResultSchema,
  CustomerMergeSchema,
  CustomerMergeSuggestionListSchema,
  CustomerUnmergeResultSchema,
} from './customer-merge.schemas.js';
import { CustomerIdSchema } from './customers.schemas.js';

/**
 * The merge of duplicate customers (J3), planned for S4. Merging and its suggestions are Owner, Admin and Manager (N204: not every
 * agent as Brief P9 line 443 says, because a Sales or Support sees only the tickets and leads of their workspaces and would leave a
 * merge half done); the merge reaches every live workspace of the organisation. Unmerging and the list of merges are Owner and Admin
 * (Brief P9 line 464). A merged customer is hidden: GET /v1/customers leaves it out and GET /v1/customers/{id} answers 404.
 */
export function registerCustomerMerge(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const tags = ['customers'];
  const when = planned('S4');
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const mergers = problemResponse(
    'forbidden: only an Owner, an Admin or a Manager merges customers (N204); or a refusal of the edge.',
  );
  const unmergers = problemResponse(
    'forbidden: only an Owner or an Admin unmerges (Brief P9); or a refusal of the edge.',
  );
  const byId = { params: z.object({ id: CustomerIdSchema }) };
  const unknown = problemResponse('not_found: no such customer in the organisation.');

  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/customers/merge',
    summary:
      'Merge the source into the target in one transaction: conversations, identities, tickets, leads and tags move; a custom field or a name, phone or email moves only when the target has none (audited: `customer.merged`, ids only).',
    tags,
    request: {
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(CustomerMergeSchema) },
    },
    responses: {
      200: {
        description: 'The merge and the target after it.',
        ...json(CustomerMergeResultSchema),
      },
      400: problemResponse(
        'validation_failed: a field, the same customer twice, or the Idempotency-Key is missing.',
      ),
      403: mergers,
      404: problemResponse(
        'not_found: the source or the target is not a live, unmerged customer of the organisation.',
      ),
      409: problemResponse('idempotency_in_progress'),
      422: problemResponse('idempotency_key_reused'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/customers/{id}/unmerge',
    summary:
      'Undo the merge of this customer (the source): exactly the rows the merge moved go back, what was made after it stays with the target (audited: `customer.unmerged`, ids only).',
    tags,
    request: { ...byId, headers: IdempotencyHeadersSchema },
    responses: {
      200: {
        description: 'The merge, now undone, and both customers.',
        ...json(CustomerUnmergeResultSchema),
      },
      400: problemResponse('validation_failed: the id, or the Idempotency-Key is missing.'),
      403: unmergers,
      404: unknown,
      409: problemResponse(
        'not_merged: the customer is not merged into another; target_merged: its target was merged in turn, unmerge that first; or idempotency_in_progress.',
      ),
      422: problemResponse('idempotency_key_reused'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/customers/{id}/merges',
    summary:
      'The merges into this customer, newest first, undone ones too: what the profile offers to unmerge.',
    tags,
    request: byId,
    responses: {
      200: { description: 'The merges.', ...json(CustomerMergeListSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: unmergers,
      404: problemResponse('not_found: no live customer with this id in the organisation.'),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/customers/{id}/merge-suggestions',
    summary:
      'Live customers of the organisation with exactly the same phone or email as this one, at most 20, newest first; never a part of a number.',
    tags,
    request: byId,
    responses: {
      200: {
        description: 'The suggestions, possibly none.',
        ...json(CustomerMergeSuggestionListSchema),
      },
      400: problemResponse('validation_failed: the id.'),
      403: mergers,
      404: problemResponse('not_found: no live customer with this id in the organisation.'),
      ...edge,
    },
  });
}
