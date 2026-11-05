import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

/** A channel account of a workspace, metadata only: never a secret (A4, N161). */
export const ChannelSchema = z
  .object({
    id: UuidSchema,
    type: z.enum(['zalo_oa', 'facebook', 'webchat']),
    displayName: z.string(),
    status: z.enum(['connected', 'token_expiring', 'disconnected']),
    teamId: UuidSchema.nullable().meta({
      description: 'The team that answers the channel; null: the default team of the workspace.',
    }),
    /** When the access token expires; null until the channel is connected (U26). */
    tokenExpiresAt: z.iso.datetime().nullable(),
    /** The code of the last failed token refresh (e.g. `zalo_invalid_grant`), null after a good one: a code, never a message (U26). */
    lastError: z.string().nullable(),
  })
  .meta({ id: 'Channel' });
export const ChannelListSchema = z
  .object({ data: z.array(ChannelSchema) })
  .meta({ id: 'ChannelList' });

/** `GET /v1/channels?workspaceId=`. */
export const ChannelListQuerySchema = z.object({ workspaceId: UuidSchema }).strict();

export const ChannelIdSchema = UuidSchema;
