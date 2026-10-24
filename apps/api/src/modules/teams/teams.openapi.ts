import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  TeamCreateSchema,
  TeamListQuerySchema,
  TeamListSchema,
  TeamSchema,
} from './teams.schemas.js';

/** The paths of teams.controller.ts, for the screen /settings/teams (A4, N160). */
export function registerTeams(registry: OpenAPIRegistry): void {
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const writer = problemResponse(
    'forbidden: only an Owner or an Admin changes teams (Phụ lục B); or a refusal of the edge.',
  );
  const reader = problemResponse(
    'forbidden: an Owner, an Admin, or a Manager for their own teams; or a refusal of the edge.',
  );
  const one = (description: string) => ({
    description,
    content: { 'application/json': { schema: TeamSchema } },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/teams',
    summary:
      'The live teams of a workspace by name (N160); a Manager sees only the teams they are in.',
    tags: ['teams'],
    request: { query: TeamListQuerySchema },
    responses: {
      200: {
        description: 'The teams.',
        content: { 'application/json': { schema: TeamListSchema } },
      },
      400: problemResponse('validation_failed: the workspaceId.'),
      403: reader,
      404: problemResponse('not_found: no workspace with this id in the organisation.'),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/teams',
    summary:
      'Make a team in a workspace (N160). The slug is made from the name, without accents; a taken one gets -2, -3….',
    tags: ['teams'],
    request: {
      headers: IdempotencyHeadersSchema,
      body: { content: { 'application/json': { schema: TeamCreateSchema } } },
    },
    responses: {
      201: one('The team.'),
      400: problemResponse('validation_failed: a field or the Idempotency-Key header.'),
      403: writer,
      404: problemResponse('not_found: no workspace with this id in the organisation.'),
      409: problemResponse('idempotency_in_progress'),
      422: problemResponse('idempotency_key_reused: the same key with another request.'),
      ...edge,
    },
  });
}
