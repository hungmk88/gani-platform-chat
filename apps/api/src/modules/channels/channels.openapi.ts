import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import { ChannelListQuerySchema, ChannelListSchema } from './channels.schemas.js';

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
