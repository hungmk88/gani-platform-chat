import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import { OverviewQuerySchema, OverviewSchema } from './overview.schemas.js';

export function registerOverview(registry: OpenAPIRegistry): void {
  registry.registerPath({
    ...planned('S5'),
    method: 'get',
    path: '/v1/overview',
    summary:
      'The five cards of #16 for one workspace (U29): open, waiting for an agent, first reply P90 today, over SLA, agents online / total. Sales and Support get their own figures (scope `me`, no agent cards).',
    tags: ['overview'],
    request: { query: OverviewQuerySchema },
    responses: {
      200: {
        description: 'The figures, computed now.',
        content: { 'application/json': { schema: OverviewSchema } },
      },
      400: problemResponse('validation_failed: the workspace id.'),
      404: problemResponse('not_found: a workspace not among the session’s.'),
      ...EDGE_ERRORS,
    },
  });
}
