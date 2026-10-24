import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

const name = z.string().trim().min(1).max(100);
/** Blank is no description. */
const description = z
  .string()
  .trim()
  .max(500)
  .transform((text) => text || null);

/** A team of a workspace as /settings/teams shows it (A4, N160). */
export const TeamSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean().meta({
      description: 'The team of the workspace that takes what no other rule sends anywhere.',
    }),
    memberCount: z.int(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Team' });
export const TeamListSchema = z.object({ data: z.array(TeamSchema) }).meta({ id: 'TeamList' });

/** `GET /v1/teams?workspaceId=`. */
export const TeamListQuerySchema = z.object({ workspaceId: UuidSchema }).strict();

/** `POST /v1/teams`: the slug is made from the name, never sent. */
export const TeamCreateSchema = z
  .object({ workspaceId: UuidSchema, name, description: description.optional() })
  .strict()
  .meta({ id: 'TeamCreate' });
