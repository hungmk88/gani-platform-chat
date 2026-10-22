import { orgMembers } from '@gani/db';
import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

export const MemberIdSchema = UuidSchema;
const RoleSchema = z.enum(orgMembers.role.enumValues);

/** `POST /v1/members/invite`: the email is stored as the CHECK of org_members wants it (lower case, no space around). */
export const InviteBodySchema = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)), role: RoleSchema })
  .strict()
  .meta({ id: 'InviteBody' });

/** A pending invitation as the person who invites sees it. Never the token: it is in the email only (spec RLS M01 §3.7). */
export const InvitationSchema = z
  .object({
    id: UuidSchema,
    email: z.email(),
    role: RoleSchema,
    status: z.literal('pending'),
    expiresAt: z.iso.datetime(),
    emailSent: z.boolean().meta({
      description:
        'False when the email could not be sent: the invitation exists, and resend-invite sends it again.',
    }),
  })
  .meta({ id: 'Invitation' });
