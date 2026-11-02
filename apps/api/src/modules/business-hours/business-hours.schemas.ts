import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// The working week of a workspace (C10-3a, N192; CEO 02/11/2026): served in openapi.json straight away (answer 3 of 16:48), not planned.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/** One ISO weekday (1 Monday … 7 Sunday): open with its hours and an optional break inside them, or closed with no hours. */
export const BusinessDaySchema = z
  .object({
    weekday: z.int().min(1).max(7),
    open: z.boolean(),
    opensAt: time.nullable(),
    closesAt: time.nullable(),
    breakStartsAt: time.nullable(),
    breakEndsAt: time.nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const hours = [d.opensAt, d.closesAt, d.breakStartsAt, d.breakEndsAt];
    if (!d.open) {
      if (hours.some((h) => h !== null))
        ctx.addIssue({ code: 'custom', message: 'a closed day has no hours' });
      return;
    }
    if (d.opensAt === null || d.closesAt === null || d.opensAt >= d.closesAt)
      ctx.addIssue({ code: 'custom', message: 'an open day opens before it closes' });
    else if ((d.breakStartsAt === null) !== (d.breakEndsAt === null))
      ctx.addIssue({ code: 'custom', message: 'a break has both ends' });
    else if (
      d.breakStartsAt !== null &&
      d.breakEndsAt !== null &&
      !(
        d.opensAt < d.breakStartsAt &&
        d.breakStartsAt < d.breakEndsAt &&
        d.breakEndsAt < d.closesAt
      )
    )
      ctx.addIssue({ code: 'custom', message: 'the break is inside the day' });
  })
  .meta({ id: 'BusinessDay' });
export type BusinessDay = z.output<typeof BusinessDaySchema>;

/** The seven days, each weekday once, in the workspace's time zone. */
const week = z
  .array(BusinessDaySchema)
  .length(7)
  .refine((days) => new Set(days.map((d) => d.weekday)).size === 7, 'each weekday once');

export const BusinessHoursSchema = z
  .object({
    /** IANA time zone of the workspace (PATCH /v1/workspaces/{id}); every hour is in it. */
    timezone: z.string(),
    /** True while the workspace has set no hours: the default week (Monday to Friday 08:00–18:00) applies. */
    isDefault: z.boolean(),
    week: z.array(BusinessDaySchema),
  })
  .meta({ id: 'BusinessHours' });

/** PUT: the whole week; it replaces the one before (no version: the workspace is locked, the last writer wins). */
export const BusinessHoursChangeSchema = z
  .object({ week })
  .strict()
  .meta({ id: 'BusinessHoursChange' });

export const WorkspaceIdParamSchema = UuidSchema;
