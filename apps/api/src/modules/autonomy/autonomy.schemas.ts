import { z } from 'zod';

import { NullableUuidSchema } from '../../openapi/schemas.js';

// #27 autonomy of a workspace (U29; Brief P9 "PATCH /v1/workspaces/{id}/autonomy", table workspace_autonomy). L0–L5 are shown;
// only L0–L1 can be chosen in Đợt 1, L2 and above (the AI answers customers) open in Đợt 2 Cổng 2 (CEO 26/10/2026).

export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;

export const AutonomySchema = z
  .object({
    level: z.enum(AUTONOMY_LEVELS),
    /** Why it was last changed; `number_error` when AutonomyGuard lowered it on its own (Brief §23). */
    reason: z.string().nullable(),
    changedBy: NullableUuidSchema,
    changedAt: z.iso.datetime().nullable(),
    /** The levels that can be chosen now: ["L0", "L1"] in Đợt 1. */
    available: z.array(z.enum(AUTONOMY_LEVELS)),
  })
  .meta({ id: 'Autonomy' });

export const AutonomyChangeSchema = z
  .object({ level: z.enum(AUTONOMY_LEVELS), reason: z.string().trim().min(1).max(500) })
  .strict()
  .meta({ id: 'AutonomyChange' });
