import { z } from 'zod';

/** `PATCH /v1/me` (endpoint-M8 §8, N162): the name the person goes by. The photo waits for a file store. */
export const MeChangeSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict()
  .meta({ id: 'MeChange' });
