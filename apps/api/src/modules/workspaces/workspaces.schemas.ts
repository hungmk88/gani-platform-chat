import { orgMembers, workspaces } from '@gani/db';
import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

export const WorkspaceIdSchema = UuidSchema;

/** An IANA time zone this runtime knows (`Asia/Ho_Chi_Minh`), the way business hours and SLA clocks will read it. */
const TimezoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone.includes('/') || zone === 'UTC';
  } catch {
    return false;
  }
}, 'an IANA time zone');

/** A workspace as the screen /settings/workspace shows it (spec-M8 §3.4, N157). */
export const WorkspaceSchema = z
  .object({
    id: UuidSchema,
    slug: z.string(),
    name: z.string(),
    template: z.enum(workspaces.template.enumValues),
    timezone: z.string(),
    defaultMaxConcurrent: z.int().meta({
      description:
        'The limit of conversations at once of an agent without their own (C9); 5 unless changed.',
    }),
    contactPhone: z.string().nullable().meta({
      description:
        'The number customers call: what {{company_phone}} of a quick reply becomes (N163); null until set.',
    }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Workspace' });
export const WorkspaceListSchema = z
  .object({ data: z.array(WorkspaceSchema) })
  .meta({ id: 'WorkspaceList' });

/** `PATCH /v1/workspaces/{id}`: what an Owner or an Admin may change, at least one; the slug and the template stay as created. */
export const WorkspaceChangeSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    timezone: TimezoneSchema.optional(),
    defaultMaxConcurrent: z.int().min(1).max(100).optional(),
    /** Null clears it. */
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 .-]{5,19}$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'WorkspaceChange' });

/** One person of a workspace (N159): `memberId` is the id of `GET /v1/members`. */
export const WorkspaceMemberSchema = z
  .object({ memberId: UuidSchema, userId: UuidSchema, role: z.enum(orgMembers.role.enumValues) })
  .meta({ id: 'WorkspaceMember' });
export const WorkspaceMemberListSchema = z
  .object({ data: z.array(WorkspaceMemberSchema) })
  .meta({ id: 'WorkspaceMemberList' });

/** `PUT /v1/workspaces/{id}/members` (N159): the whole list, members of the organisation by their member id. */
export const WorkspaceMembersBodySchema = z
  .object({
    memberIds: z
      .array(UuidSchema)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'no member twice'),
  })
  .strict()
  .meta({ id: 'WorkspaceMembersBody' });
