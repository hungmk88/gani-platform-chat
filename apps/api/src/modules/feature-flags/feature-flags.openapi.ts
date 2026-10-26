import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { planned } from '../../openapi/planned-status.js';
import { EDGE_ERRORS, problemResponse } from '../../openapi/schemas.js';
import {
  FEATURE_FLAG_KEYS,
  FeatureFlagChangeSchema,
  FeatureFlagListSchema,
  FeatureFlagQuerySchema,
  FeatureFlagSchema,
} from './feature-flags.schemas.js';

export function registerFeatureFlags(registry: OpenAPIRegistry): void {
  const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
  const tags = ['feature-flags'];
  const forbidden = problemResponse(
    'forbidden: only an Owner or an Admin (Phụ lục B "Bật/tắt AI nội bộ", "tắt feature flag"); or a refusal of the edge.',
  );
  const edge = { 401: EDGE_ERRORS[401], 503: EDGE_ERRORS[503] };
  registry.registerPath({
    ...planned('S5'),
    method: 'get',
    path: '/v1/feature-flags',
    summary:
      'Every flag of Đợt 1 for one workspace, on or off, and whether it is locked in this phase.',
    tags,
    request: { query: FeatureFlagQuerySchema },
    responses: {
      200: { description: 'The flags.', ...json(FeatureFlagListSchema) },
      400: problemResponse('validation_failed: the workspace id.'),
      403: forbidden,
      404: problemResponse('not_found: a workspace not among the session’s.'),
      ...edge,
    },
  });
  registry.registerPath({
    ...planned('S5'),
    method: 'patch',
    path: '/v1/feature-flags/{key}',
    summary:
      'Turn a flag on or off for one workspace (audited: `feature_flag.changed`). A flag locked in this phase cannot be turned on.',
    tags,
    request: {
      params: z.object({ key: z.enum(FEATURE_FLAG_KEYS) }),
      body: { required: true, ...json(FeatureFlagChangeSchema) },
    },
    responses: {
      200: { description: 'The flag after the change.', ...json(FeatureFlagSchema) },
      400: problemResponse('validation_failed: the key, the workspace id or `enabled`.'),
      403: forbidden,
      404: problemResponse('not_found: a workspace not among the session’s.'),
      409: problemResponse('not_in_phase: this flag cannot be turned on in Đợt 1 (U29).'),
      ...edge,
    },
  });
}
