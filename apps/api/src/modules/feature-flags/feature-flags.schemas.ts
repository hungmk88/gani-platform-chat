import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// #27 feature flags of a workspace (U29, CEO 26/10/2026; Brief P9 "GET/PATCH /v1/feature-flags"). The catalogue is N74's
// feature_flags_global; a workspace switches one through feature_flags_overrides.

/** The flags of Đợt 1 (U29). `ai.customer_reply` must stay off in Đợt 1; `channel.webchat` is Đợt 2. */
export const FEATURE_FLAG_KEYS = [
  'ai.internal',
  'ai.customer_reply',
  'channel.zalo',
  'channel.webchat',
] as const;

export const FeatureFlagSchema = z
  .object({
    key: z.enum(FEATURE_FLAG_KEYS),
    description: z.string(),
    enabled: z.boolean(),
    /** True: it cannot be turned on in this phase (`ai.customer_reply`, `channel.webchat` in Đợt 1); the screen shows it greyed. */
    locked: z.boolean(),
    lockedReason: z.enum(['phase_2']).nullable(),
  })
  .meta({ id: 'FeatureFlag' });

export const FeatureFlagListSchema = z
  .object({ data: z.array(FeatureFlagSchema) })
  .meta({ id: 'FeatureFlagList' });

export const FeatureFlagQuerySchema = z.object({ workspaceId: UuidSchema }).strict();

export const FeatureFlagChangeSchema = z
  .object({ workspaceId: UuidSchema, enabled: z.boolean() })
  .strict()
  .meta({ id: 'FeatureFlagChange' });
