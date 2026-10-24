import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
  WorkspaceChangeSchema,
  WorkspaceIdSchema,
  WorkspaceListSchema,
  WorkspaceSchema,
} from './workspaces.schemas.js';

/** The paths of workspaces.controller.ts, for the screen /settings/workspace (N157). */
export function registerWorkspaces(registry: OpenAPIRegistry): void {
  const forbidden = problemResponse(
    'forbidden: only an Owner or an Admin (Phụ lục B "Cài đặt workspace"); or a refusal of the edge.',
  );
  registry.registerPath({
    method: 'get',
    path: '/v1/workspaces',
    summary: 'The workspaces of the organisation of the session, by name (Owner or Admin).',
    tags: ['workspaces'],
    responses: {
      200: {
        description: 'Every workspace that is not deleted.',
        content: { 'application/json': { schema: WorkspaceListSchema } },
      },
      401: EDGE_ERRORS[401],
      403: forbidden,
      503: EDGE_ERRORS[503],
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/workspaces/{id}',
    summary:
      'Change the name, the time zone or the default limit of conversations of a workspace (N157). The slug and the template stay as created.',
    tags: ['workspaces'],
    request: {
      params: z.object({ id: WorkspaceIdSchema }),
      body: { content: { 'application/json': { schema: WorkspaceChangeSchema } } },
    },
    responses: {
      200: {
        description: 'The workspace as it now is.',
        content: { 'application/json': { schema: WorkspaceSchema } },
      },
      400: problemResponse('validation_failed: the id, or nothing to change, or a field.'),
      401: EDGE_ERRORS[401],
      403: forbidden,
      404: problemResponse('not_found: no workspace with this id in the organisation.'),
      503: EDGE_ERRORS[503],
    },
  });
}
