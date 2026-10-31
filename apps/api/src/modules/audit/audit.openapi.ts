import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import { AuditLogListSchema, AuditLogQuerySchema } from './audit.schemas.js';

/** The paths of audit.controller.ts (Brief P9, A9a). */
export function registerAuditLogs(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/v1/audit-logs',
    summary:
      "The audit log of the session's organisation, newest first, filtered by person, action and time (A9a; no cursor yet).",
    tags: ['audit'],
    request: { query: AuditLogQuerySchema },
    responses: {
      200: {
        description: 'At most `limit` rows.',
        content: { 'application/json': { schema: AuditLogListSchema } },
      },
      400: problemResponse(
        'validation_failed: a filter, `from` not before `to`, or an unknown parameter (the organisation is never one).',
      ),
      403: problemResponse(
        'forbidden: only an Owner or an Admin reads the audit log (Brief P9); or a refusal of the edge.',
      ),
      401: EDGE_ERRORS[401],
      503: EDGE_ERRORS[503],
    },
  });
}
