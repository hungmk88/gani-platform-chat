import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, UuidSchema, problemResponse } from '../../openapi/schemas.js';
import { AiSettingsChangeSchema, AiSettingsSchema, PromptVersionListSchema } from './ai.schemas.js';

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

  // U61: the settings of the internal AI of a workspace (see ai.schemas.ts for who changes what).
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const params = z.object({ id: UuidSchema });
  const notFound = problemResponse('not_found: a workspace not among the session’s.');
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  registry.registerPath({
    ...planned('S5'),
    method: 'get',
    path: '/v1/workspaces/{id}/ai-settings',
    summary:
      'The internal AI of a workspace: environment, E1/L1 on or off, the monthly budget in USD and what was spent this month (Owner, Admin).',
    tags: ['ai'],
    request: { params },
    responses: {
      200: { description: 'The settings.', ...json(AiSettingsSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.'),
      404: notFound,
      ...edge,
    },
  });
  registry.registerPath({
    ...planned('S5'),
    method: 'patch',
    path: '/v1/workspaces/{id}/ai-settings',
    summary:
      'Change only what is sent (audited: `workspace.ai_settings_changed`). E1/L1 and the budget: Owner or Admin; `environment: production`: the Owner alone. No lock on `production` (Q1 settled, U74); E1/L1 may be on in any environment (U75).',
    tags: ['ai'],
    request: { params, body: { required: true, ...json(AiSettingsChangeSchema) } },
    responses: {
      200: { description: 'The settings after the change.', ...json(AiSettingsSchema) },
      400: problemResponse(
        'validation_failed: an empty body, an unknown field, a budget out of 0–1 000 000.',
      ),
      403: problemResponse(
        'forbidden: an Admin moving to `production`, or another role; or a refusal of the edge.',
      ),
      404: notFound,
      ...edge,
    },
  });
}
