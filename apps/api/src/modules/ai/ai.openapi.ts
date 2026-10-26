import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import { PromptVersionListSchema } from './ai.schemas.js';

/** E20 (U35): read-only, Owner and Admin; there is no path that changes a prompt. */
export function registerAi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    ...planned('S5'),
    method: 'get',
    path: '/v1/ai/prompts',
    summary:
      'The versions of the prompts the internal AI uses, with when and by whom each was approved (E20). Read-only: no button edits a prompt.',
    tags: ['ai'],
    responses: {
      200: {
        description: 'The versions, by key then newest first.',
        content: { 'application/json': { schema: PromptVersionListSchema } },
      },
      403: problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.'),
      401: EDGE_ERRORS[401],
      503: EDGE_ERRORS[503],
    },
  });
}
