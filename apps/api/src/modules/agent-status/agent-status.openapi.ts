import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, problemResponse, UuidSchema } from '../../openapi/schemas.js';
import {
  AgentStatusChangeSchema,
  AgentStatusSchema,
  TeamAgentStatusListSchema,
} from './agent-status.schemas.js';

/**
 * The status of an agent (U82) and of a team (U85), planned for S4. Every role that holds conversations (Owner, Admin, Manager, Sales,
 * Support) has a status and sets only their own; Marketing and Viewer have none (403). A change is pushed by `agent_status.changed`
 * to the rooms `user:{id}` and `ws:{id}` (U86, realtime-spec §3).
 */
export function registerAgentStatus(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const when = planned('S4');
  const holders = problemResponse(
    'forbidden: marketing and viewer hold no conversation and have no status; or a refusal of the edge.',
  );
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/me/agent-status',
    summary: 'The signed-in person’s own status as an agent, since when, and why.',
    tags: ['agent-status'],
    responses: {
      200: { description: 'The status.', ...json(AgentStatusSchema) },
      403: holders,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'put',
    path: '/v1/me/agent-status',
    summary:
      'Set one’s own status (`reason: manual`); the same status again changes nothing, not even `since`.',
    tags: ['agent-status'],
    request: { body: { required: true, ...json(AgentStatusChangeSchema) } },
    responses: {
      200: { description: 'The status now.', ...json(AgentStatusSchema) },
      400: problemResponse('validation_failed: an unknown status or another field.'),
      403: holders,
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'get',
    path: '/v1/teams/{id}/agent-status',
    summary:
      'The status of each member of the team who holds conversations, and their minutes busy today (U42). Read only.',
    tags: ['agent-status'],
    request: { params: z.object({ id: UuidSchema }) },
    responses: {
      200: { description: 'The members, by name.', ...json(TeamAgentStatusListSchema) },
      400: problemResponse('validation_failed: the id.'),
      403: problemResponse(
        'forbidden: only an Owner, an Admin, or a Manager who is a member of the team; or a refusal of the edge.',
      ),
      404: problemResponse('not_found: no team with this id in the session’s workspaces.'),
      ...edge,
    },
  });
}
