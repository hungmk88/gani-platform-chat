import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// The days off of a workspace (C10-3b-i, N192, U44; CEO 02/11/2026 16:48 and 18:40): whole local dates in the workspace's time zone.

const date = z.iso.date();
const name = z.string().trim().min(1).max(100);

export const HolidaySchema = z
  .object({ id: UuidSchema, name: z.string(), startsOn: date, endsOn: date })
  .meta({ id: 'Holiday' });

/** The live days off that end on `from` or later (default: today in the workspace's time zone), by start; no cursor. */
export const HolidayListSchema = z
  .object({ data: z.array(HolidaySchema) })
  .meta({ id: 'HolidayList' });
export const HolidayListQuerySchema = z.object({ from: date.optional() }).strict();

export const HolidayCreateSchema = z
  .object({ name, startsOn: date, endsOn: date })
  .strict()
  .refine((h) => h.startsOn <= h.endsOn, 'startsOn is on or before endsOn')
  .meta({ id: 'HolidayCreate' });
