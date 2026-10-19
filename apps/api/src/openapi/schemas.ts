import { z } from 'zod';

// The shapes every endpoint shares (Brief P9). Each has an `id`, so the generated document names it once under components/schemas and
// refers to it, instead of repeating it in every path.

/** RFC 9457 body of every error (problem.ts); `code` is the snake_case word of P9 a client switches on (N132). */
export const ProblemSchema = z
  .object({
    type: z.literal('about:blank'),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    detail: z.string().optional(),
    traceId: z.uuid().optional(),
  })
  .meta({
    id: 'Problem',
    description: 'RFC 9457 problem details; `code` is the stable word (Brief P9).',
  });

export const UuidSchema = z.uuid().meta({ id: 'Uuid', description: 'UUIDv7.' });

/** `?cursor=<opaque>&limit=50` (max 100) → `{ data, nextCursor }`; no offset (P9). */
export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const cursorPage = <T extends z.ZodType>(item: T, id: string) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() }).meta({ id });
