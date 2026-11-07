import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
  BusinessHoursChangeSchema,
  BusinessHoursSchema,
  WorkspaceIdParamSchema,
} from './business-hours.schemas.js';

/** The paths of business-hours.controller.ts (C10-3a, N192), for /settings/workspace: an Owner or an Admin. */
export function registerBusinessHours(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const common = {
    401: EDGE_ERRORS[401],
    403: problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.'),
    404: problemResponse('not_found: no workspace with this id in the organisation.'),
    503: EDGE_ERRORS[503],
  };
  const params = z.object({ id: WorkspaceIdParamSchema });
  const tags = ['workspaces'];
  registry.registerPath({
    method: 'get',
    path: '/v1/workspaces/{id}/business-hours',
    summary:
      'The working week of a workspace in its time zone; the default week (Monday to Friday 08:00–17:30, break 12:00–13:00) while none is set.',
    tags,
    request: { params },
    responses: { 200: { description: 'The week.', ...json(BusinessHoursSchema) }, ...common },
  });
  registry.registerPath({
    method: 'put',
    path: '/v1/workspaces/{id}/business-hours',
    summary:
      'Replace the whole week (audited `workspace.hours_changed` with the weekdays that changed). No version: the last writer wins.',
    tags,
    request: { params, body: { required: true, ...json(BusinessHoursChangeSchema) } },
    responses: {
      200: { description: 'The week as it now is.', ...json(BusinessHoursSchema) },
      400: problemResponse(
        'validation_failed: not seven days, a weekday twice, an hour not HH:MM, an open day that does not open before it closes, a break not inside its day, or a closed day with hours.',
      ),
      ...common,
    },
  });
}
