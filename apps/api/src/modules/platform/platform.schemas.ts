import { z } from 'zod';

import { CursorQuerySchema, cursorPage, UuidSchema } from '../../openapi/schemas.js';

// The Platform screen #30 (U65, CEO 05/11/2026; Brief P9 lines 447 and 473): the health of each organisation and the access sessions
// of a platform operator, and the channel policies every role reads. Contract first (N167): planned.ts, built in S5.

const at = z.iso.datetime();
const count = z.int().min(0);

export const TenantHealthSchema = z
  .object({
    orgId: UuidSchema,
    slug: z.string(),
    name: z.string(),
    /** The channel accounts of the organisation and their Zalo tokens. */
    channels: z
      .object({
        total: count,
        /** Tokens that expire within the next 24 hours (Brief P19). */
        tokenExpiringSoon: count,
        tokenExpired: count,
      })
      .meta({ id: 'TenantHealthChannels' }),
    /** The AI spend of the current month in VND. */
    aiCostMonthVnd: z.null().meta({
      description:
        'null until the AI Gateway exists; Q1 still locks production (U65, CEO 05/11/2026).',
    }),
  })
  .meta({ id: 'TenantHealth' });

export const TenantHealthPageSchema = cursorPage(TenantHealthSchema, 'TenantHealthPage');
export const TenantHealthQuerySchema = CursorQuerySchema;

export const AccessSessionCreateSchema = z
  .object({
    orgId: UuidSchema,
    /** Why the operator needs the organisation's data: 10 to 500 characters, trimmed, counted in NFC. */
    reason: z.string().trim().normalize('NFC').min(10).max(500),
  })
  .strict()
  .meta({ id: 'AccessSessionCreate' });

/** One access of a platform operator to one organisation: one row of platform_access_logs with its reason, 60 minutes (N69). */
export const AccessSessionSchema = z
  .object({ id: UuidSchema, orgId: UuidSchema, startedAt: at, expiresAt: at })
  .meta({ id: 'AccessSession' });

export const CHANNEL_TYPES = ['zalo_oa', 'facebook', 'webchat'] as const;
export const MESSAGE_CLASSES = ['advisory', 'transaction', 'broadcast'] as const;

const policyFields = {
  /** Free window from the customer's last message; null: the class has no window. */
  freeWindowSeconds: count.nullable(),
  /** Free messages inside the window; null: no quota. */
  freeMessageQuota: count.nullable(),
  /** Price of one message outside what is free, from the channel's published price list; null: none published. */
  unitPriceVnd: count.nullable(),
  outsideWindowAllowed: z.boolean(),
  sourceUrl: z.string().nullable(),
  sourceDate: z.iso.date().nullable(),
  note: z.string(),
};

export const ChannelPolicySchema = z
  .object({
    id: UuidSchema,
    channelType: z.enum(CHANNEL_TYPES),
    messageClass: z.enum(MESSAGE_CLASSES),
    effectiveFrom: at,
    ...policyFields,
  })
  .meta({ id: 'ChannelPolicy' });

/** The policy in force of each channel and class, now. */
export const ChannelPolicyListSchema = z
  .object({ data: z.array(ChannelPolicySchema) })
  .meta({ id: 'ChannelPolicyList' });

/**
 * A new version of the policy `{id}` names (its channel and class): never an edit of a row. `effectiveFrom` must be later than the
 * one of the version in force, else 422 invalid_effective_from.
 */
export const ChannelPolicyChangeSchema = z
  .object({
    effectiveFrom: at,
    ...policyFields,
    sourceUrl: z.string().trim().min(1).nullable(),
    note: z.string().trim().min(1),
  })
  .strict()
  .meta({ id: 'ChannelPolicyChange' });

export const ChannelPolicyIdSchema = UuidSchema;
