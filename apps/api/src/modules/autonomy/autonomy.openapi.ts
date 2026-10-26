import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, UuidSchema, problemResponse } from '../../openapi/schemas.js';
import { AutonomyChangeSchema, AutonomySchema } from './autonomy.schemas.js';

export function registerAutonomy(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const params = z.object({ id: UuidSchema });
  const tags = ['autonomy'];
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const notFound = problemResponse('not_found: a workspace not among the session’s.');
  registry.registerPath({
    ...planned('S5'),
    method: 'get',
    path: '/v1/workspaces/{id}/autonomy',
    summary:
      'The autonomy level of a workspace and the levels that can be chosen now (Owner, Admin).',
    tags,
    request: { params },
    responses: {
      200: { description: 'The level.', ...json(AutonomySchema) },
      400: problemResponse('validation_failed: the id.'),
      403: problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.'),
      404: notFound,
      ...edge,
    },
  });
  registry.registerPath({
    ...planned('S5'),
    method: 'patch',
    path: '/v1/workspaces/{id}/autonomy',
    summary:
      'Change the level with a reason (audited: `workspace.autonomy_changed`). Raising it is the Owner’s alone; lowering it, Owner or Admin (Phụ lục B).',
    tags,
    request: { params, body: { required: true, ...json(AutonomyChangeSchema) } },
    responses: {
      200: { description: 'The level after the change.', ...json(AutonomySchema) },
      400: problemResponse('validation_failed: the level or the reason (1–500 characters).'),
      403: problemResponse(
        'forbidden: an Admin raising the level, or another role; or a refusal of the edge.',
      ),
      404: notFound,
      409: problemResponse('not_in_phase: L2 and above open in Đợt 2 (U29).'),
      ...edge,
    },
  });
}
