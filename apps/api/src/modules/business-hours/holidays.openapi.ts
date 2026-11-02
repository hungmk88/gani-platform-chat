import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import { WorkspaceIdParamSchema } from './business-hours.schemas.js';
import {
  HolidayChangeSchema,
  HolidayCreateSchema,
  HolidayIdSchema,
  HolidayListQuerySchema,
  HolidayListSchema,
  HolidaySchema,
} from './holidays.schemas.js';

/** The paths of holidays.controller.ts (C10-3b, N192, U44), for /settings/workspace: an Owner or an Admin. */
export function registerHolidays(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const tags = ['workspaces'];
  const edge = {
    401: EDGE_ERRORS[401],
    403: problemResponse('forbidden: only an Owner or an Admin; or a refusal of the edge.'),
    503: EDGE_ERRORS[503],
  };
  const notFound = problemResponse(
    'not_found: no such workspace in the organisation, or no such live day off in it.',
  );
  const rules = problemResponse(
    'holiday_overlap: the dates meet another live day off of the workspace; holiday_in_past: the day off ends before today in the workspace’s time zone (a day off that is over is never added, changed nor removed). Audited `workspace.holiday_rejected`.',
  );
  const ws = z.object({ id: WorkspaceIdParamSchema });
  const one = z.object({ id: WorkspaceIdParamSchema, hid: HolidayIdSchema });
  registry.registerPath({
    method: 'get',
    path: '/v1/workspaces/{id}/holidays',
    summary:
      'The live days off that end on `from` or later (default: today, workspace time), by start.',
    tags,
    request: { params: ws, query: HolidayListQuerySchema },
    responses: {
      200: { description: 'The days off.', ...json(HolidayListSchema) },
      400: problemResponse('validation_failed: `from` is not a date.'),
      404: notFound,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/workspaces/{id}/holidays',
    summary: 'Add a day off (audited `workspace.holiday_added`). Starting today is allowed.',
    tags,
    request: { params: ws, body: { required: true, ...json(HolidayCreateSchema) } },
    responses: {
      201: { description: 'The day off.', ...json(HolidaySchema) },
      400: problemResponse(
        'validation_failed: the name (1–100), a date, or startsOn after endsOn.',
      ),
      404: notFound,
      422: rules,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/workspaces/{id}/holidays/{hid}',
    summary: 'Rename a day off or move its dates (audited `workspace.holiday_changed`).',
    tags,
    request: { params: one, body: { required: true, ...json(HolidayChangeSchema) } },
    responses: {
      200: { description: 'The day off as it now is.', ...json(HolidaySchema) },
      400: problemResponse(
        'validation_failed: a field, nothing to change, or startsOn after endsOn.',
      ),
      404: notFound,
      422: rules,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/workspaces/{id}/holidays/{hid}',
    summary:
      'Remove a day off that is not over (audited `workspace.holiday_removed`); its dates are free again.',
    tags,
    request: { params: one },
    responses: { 204: { description: 'Removed.' }, 404: notFound, 422: rules, ...edge },
  });
}
