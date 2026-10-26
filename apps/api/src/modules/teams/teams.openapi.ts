import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { EDGE_ERRORS, IdempotencyHeadersSchema, problemResponse } from '../../openapi/schemas.js';
import {
  TeamChangeSchema,
  TeamChannelsBodySchema,
  TeamCreateSchema,
  TeamIdSchema,
  TeamListQuerySchema,
  TeamListSchema,
  TeamMemberListSchema,
  TeamMembersBodySchema,
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
  const noTeam = problemResponse('not_found: no live team with this id in the organisation.');
  const one = (description: string) => ({
    description,
    content: { 'application/json': { schema: TeamSchema } },
  });
  const people = {
    description: 'The people of the team, by role.',
    content: { 'application/json': { schema: TeamMemberListSchema } },
  };
  const params = z.object({ id: TeamIdSchema });

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
  registry.registerPath({
    method: 'patch',
    path: '/v1/teams/{id}',
    summary:
      'Change the name, the description, or make the team the default one of its workspace (the old default loses the flag).',
    tags: ['teams'],
    request: {
      params,
      body: { content: { 'application/json': { schema: TeamChangeSchema } } },
    },
    responses: {
      200: one('The team as it now is.'),
      400: problemResponse('validation_failed: the id, nothing to change, or a field.'),
      403: writer,
      404: noTeam,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/teams/{id}',
    summary: 'End a team and its memberships (N160). The default team of a workspace stays.',
    tags: ['teams'],
    request: { params },
    responses: {
      204: { description: 'Ended.' },
      400: problemResponse('validation_failed: the id.'),
      403: writer,
      404: noTeam,
      409: problemResponse(
        'team_in_use: the default team of its workspace, or a team that answers a channel.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/teams/{id}/members',
    summary: 'The people of a team (N160); a Manager only of a team they are in.',
    tags: ['teams'],
    request: { params },
    responses: {
      200: people,
      400: problemResponse('validation_failed: the id.'),
      403: reader,
      404: noTeam,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'put',
    path: '/v1/teams/{id}/members',
    summary:
      'Set the whole list of people of a team by member id (N160); each must be a person of the team’s workspace.',
    tags: ['teams'],
    request: {
      params,
      body: { content: { 'application/json': { schema: TeamMembersBodySchema } } },
    },
    responses: {
      200: people,
      400: problemResponse(
        'validation_failed: the id, more than 500 or the same member twice, or someone not in the team’s workspace.',
      ),
      403: writer,
      404: noTeam,
      ...edge,
    },
  });
  registry.registerPath({
    method: 'put',
    path: '/v1/teams/{id}/channels',
    summary:
      'Set the whole list of channel accounts the team answers (N161); each must be a live channel of the team’s workspace. A channel of another team moves to this one; one left out goes back to the default team.',
    tags: ['teams'],
    request: {
      params,
      body: { content: { 'application/json': { schema: TeamChannelsBodySchema } } },
    },
    responses: {
      200: one('The team as it now is.'),
      400: problemResponse(
        'validation_failed: the id, more than 200 or the same channel twice, or a channel not of the team’s workspace.',
      ),
      403: writer,
      404: noTeam,
      ...edge,
    },
  });
}
