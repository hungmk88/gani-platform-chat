import { orgMembers } from '@gani/db';
import { z } from 'zod';

import { CursorQuerySchema, cursorPage, UuidSchema } from '../../openapi/schemas.js';

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

/** `GET /v1/members` (N153): `?cursor=&limit=` like every list (P9). */
export const MemberListQuerySchema = CursorQuerySchema;

/** A member of the organisation, or a pending invitation, as the screen of an Owner or an Admin shows it (#19, N12, N153). */
export const MemberSchema = z
  .object({
    id: UuidSchema,
    userId: UuidSchema.nullable().meta({ description: 'Null for an invitation not taken yet.' }),
    name: z.string().nullable(),
    email: z.email(),
    role: RoleSchema,
    status: z.enum(['active', 'suspended', 'pending', 'expired']).meta({
      description:
        '`pending`: invited, link still valid; `expired`: invited, link past its 7 days (resend-invite renews it).',
    }),
    twoFactorEnabled: z.boolean(),
    expiresAt: z.iso
      .datetime()
      .nullable()
      .meta({ description: 'The end of the invitation link; null for a member.' }),
    maxConcurrentConversations: z.int().nullable().meta({
      description:
        "The member's own limit of conversations at once (C9); null: the workspace's default applies.",
    }),
  })
  .meta({ id: 'Member' });
export const MemberPageSchema = cursorPage(MemberSchema, 'MemberPage');

/** `PATCH /v1/members/{id}/role` (N154). */
export const RoleBodySchema = z.object({ role: RoleSchema }).strict().meta({ id: 'RoleBody' });

/** `PATCH /v1/members/{id}/capacity` (C9, N156): the member's own limit of conversations at once. */
export const CapacityBodySchema = z
  .object({ maxConcurrentConversations: z.int().min(1).max(100) })
  .strict()
  .meta({ id: 'CapacityBody' });

/** `POST /v1/members/{id}/2fa/reset` (N155): why, for the audit; written by an Owner or an Admin, kept out of every log. */
export const TwoFactorResetBodySchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict()
  .meta({ id: 'TwoFactorResetBody' });
