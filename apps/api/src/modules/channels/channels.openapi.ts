import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
  ChannelIdSchema,
  ChannelListQuerySchema,
  ChannelListSchema,
  ChannelSchema,
} from './channels.schemas.js';

/** The paths of channels.controller.ts (A4, N161). */
export function registerChannels(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/v1/channels',
    summary:
      'The live channel accounts of a workspace by name, and the team that answers each (N161). Metadata only, never a secret.',
    tags: ['channels'],
    request: { query: ChannelListQuerySchema },
    responses: {
      200: {
        description: 'The channels.',
        content: { 'application/json': { schema: ChannelListSchema } },
      },
      400: problemResponse('validation_failed: the workspaceId.'),
      403: problemResponse(
        'forbidden: only an Owner or an Admin reads the channels (Phụ lục B); or a refusal of the edge.',
      ),
      404: problemResponse('not_found: no workspace with this id in the organisation.'),
      401: EDGE_ERRORS[401],
      503: EDGE_ERRORS[503],
    },
  });
}

/**
 * Managing a channel account (U26), planned for S3 with the Zalo OA connector. Owner and Admin only (Phụ lục B "Cài đặt workspace,
 * kênh, team"). Connecting a Zalo OA (`POST /v1/channels/zalo/connect`) waits for Q6: no contract until its OAuth flow is known.
 */
export function registerChannelWrites(registry: OpenAPIRegistry): void {
  const when = planned('S3');
  const byId = { params: z.object({ id: ChannelIdSchema }) };
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  const owners = problemResponse(
    'forbidden: only an Owner or an Admin manages the channels (Phụ lục B); or a refusal of the edge.',
  );
  const notFound = problemResponse(
    'not_found: no live channel with this id in the session’s workspaces.',
  );
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/channels/{id}/refresh-token',
    summary:
      'Refresh the access token of the channel now, as the refresh job would; the channel answers with its new `tokenExpiresAt`, `status` and `lastError` null.',
    tags: ['channels'],
    request: byId,
    responses: {
      200: {
        description: 'The channel after a good refresh.',
        content: { 'application/json': { schema: ChannelSchema } },
      },
      403: owners,
      404: notFound,
      502: problemResponse(
        'channel_unavailable: the platform refused or did not answer, or the channel has no refresh token; the code is kept in `lastError` of GET /v1/channels.',
      ),
      ...edge,
    },
  });
  registry.registerPath({
    ...when,
    method: 'post',
    path: '/v1/channels/{id}/disconnect',
    summary:
      'Disconnect the channel, fail-closed (N102): in one transaction, all four secret columns (app_secret_enc, oa_secret_key_enc, access_token_enc, refresh_token_enc) set to null, status `disconnected`, soft delete (it leaves GET /v1/channels, its webhooks are refused), audited `channel.disconnected` (the channel type, never a secret). Using the channel again is a new connect (waits for Q6).',
    tags: ['channels'],
    request: byId,
    responses: {
      204: { description: 'Disconnected.' },
      403: owners,
      404: notFound,
      ...edge,
    },
  });
}
