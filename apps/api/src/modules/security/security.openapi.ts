import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  SecurityAlertListQuerySchema,
  SecurityAlertPageSchema,
  SecurityIncidentChangeSchema,
  SecurityIncidentCreateSchema,
  SecurityIncidentIdSchema,
  SecurityIncidentListQuerySchema,
  SecurityIncidentPageSchema,
  SecurityIncidentSchema,
} from './security.schemas.js';

/**
 * The paths of P11 (U35, N167): Owner, Admin, and a platform operator inside an access session of the organisation (Phụ lục B "Mở sự cố
 * bảo mật"). Everything is of the organisation of the session; nothing crosses organisations.
 */
export function registerSecurity(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const tags = ['security'];
  const when = planned('S5');
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const forbidden = problemResponse(
    'forbidden: only an Owner, an Admin or a platform operator in an access session; or a refusal of the edge.',
  );
  const byId = { params: z.object({ id: SecurityIncidentIdSchema }) };

  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/security-alerts',
    summary: 'The security alerts of the organisation, newest first.',
    tags,
    request: { query: SecurityAlertListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(SecurityAlertPageSchema) },
      400: problemResponse('validation_failed: a parameter or the cursor.'),
      403: forbidden,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/security-incidents',
    summary: 'The incidents of the organisation, newest first.',
    tags,
    request: { query: SecurityIncidentListQuerySchema },
    responses: {
      200: { description: 'A page.', ...json(SecurityIncidentPageSchema) },
      400: problemResponse('validation_failed: a parameter or the cursor.'),
      403: forbidden,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/security-incidents',
    summary:
      'Open an incident: title, severity, who handles it, and the alerts it covers (audited: `security.incident_opened`).',
    tags,
    request: {
      headers: IdempotencyHeadersSchema,
      body: { required: true, ...json(SecurityIncidentCreateSchema) },
    },
    responses: {
      201: { description: 'The incident, open.', ...json(SecurityIncidentSchema) },
      400: problemResponse('validation_failed: a field, or the Idempotency-Key is missing.'),
      403: forbidden,
      409: problemResponse('idempotency_in_progress'),
      422: problemResponse(
        'invalid_handler: not an active Owner or Admin of the organisation; invalid_alert: an alert not of the organisation; or idempotency_key_reused.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'patch',
    path: '/v1/security-incidents/{id}',
    summary:
      'Close an incident, or hand it to someone else (audited: `security.incident_changed`). A closed one stays closed.',
    tags,
    request: { ...byId, body: { required: true, ...json(SecurityIncidentChangeSchema) } },
    responses: {
      200: { description: 'The incident after the change.', ...json(SecurityIncidentSchema) },
      400: problemResponse('validation_failed: a field, or nothing to change.'),
      403: forbidden,
      404: problemResponse('not_found: no such incident in the organisation.'),
      409: problemResponse('incident_closed: it is already closed.'),
      422: problemResponse('invalid_handler: not an active Owner or Admin of the organisation.'),
      ...edge,
    },
  });
}
