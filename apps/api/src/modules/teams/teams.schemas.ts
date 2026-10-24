import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';
import { WorkspaceMemberListSchema } from '../workspaces/workspaces.schemas.js';

export const TeamIdSchema = UuidSchema;

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

/** `PATCH /v1/teams/{id}`: at least one field; `isDefault: true` takes the flag from the workspace's old default. */
export const TeamChangeSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'TeamChange' });

/** `PUT /v1/teams/{id}/members`: the whole list, members of the team's workspace by member id. */
export const TeamMembersBodySchema = z
  .object({
    memberIds: z
      .array(UuidSchema)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'no member twice'),
  })
  .strict()
  .meta({ id: 'TeamMembersBody' });

/** The people of a team: the same shape as those of a workspace. */
export const TeamMemberListSchema = WorkspaceMemberListSchema;
