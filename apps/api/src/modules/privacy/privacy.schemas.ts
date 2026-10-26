import { z } from 'zod';

import { CursorQuerySchema, cursorPage, UuidSchema } from '../../openapi/schemas.js';

// P7, requests about personal data (#11; U35, CEO 26/10/2026; Brief P9 "/v1/privacy-requests"). Đợt 1 has two kinds, export and erase,
// of one customer found by phone (GET /v1/customers?q=). A request is made first, then executed (N167): erasing cannot be undone.
// Legal deadlines wait for the lawyer (U24 (d)) and are not part of the contract.

const at = z.iso.datetime();
const named = z.object({ id: UuidSchema, name: z.string() });

export const PRIVACY_REQUEST_KINDS = ['export', 'erase'] as const;

export const PrivacyRequestSchema = z
  .object({
    id: UuidSchema,
    kind: z.enum(PRIVACY_REQUEST_KINDS),
    /** `pending` until executed; `done` after; `failed` if the execution stopped (nothing half done: one transaction). */
    status: z.enum(['pending', 'done', 'failed']),
    /** The customer; `displayName` is null once erased. */
    customer: z
      .object({ id: UuidSchema, displayName: z.string().nullable() })
      .meta({ id: 'PrivacyRequestCustomer' }),
    /** Why (the customer's request, its channel): kept in the audit log, never in the application log. */
    reason: z.string(),
    requestedBy: named,
    createdAt: at,
    executedAt: at.nullable(),
  })
  .meta({ id: 'PrivacyRequest' });

export const PrivacyRequestPageSchema = cursorPage(PrivacyRequestSchema, 'PrivacyRequestPage');
export const PrivacyRequestListQuerySchema = CursorQuerySchema;

export const PrivacyRequestCreateSchema = z
  .object({
    customerId: UuidSchema,
    kind: z.enum(PRIVACY_REQUEST_KINDS),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .meta({ id: 'PrivacyRequestCreate' });

/** What `export` gives: the customer's own data, as JSON. No id of another person, no internal note. */
export const PrivacyExportSchema = z
  .object({
    exportedAt: at,
    customer: z.object({
      displayName: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      /** How the channels know them, by the name of the channel account (not its internal id). */
      identities: z.array(z.object({ type: z.enum(['zalo_uid']), channelName: z.string() })),
    }),
    conversations: z.array(
      z.object({
        id: UuidSchema,
        channelName: z.string(),
        startedAt: at,
        messages: z.array(
          z.object({
            at,
            from: z.enum(['customer', 'agent', 'bot']),
            text: z.string().nullable(),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'PrivacyExport' });

/**
 * What `erase` did (N167): the profile's name, phone and email, the identities of the channels and the text of the customer's messages
 * are gone; conversations and tickets stay, anonymous, so the figures of the company still add up.
 */
export const PrivacyErasureSchema = z
  .object({
    request: PrivacyRequestSchema,
    erased: z.object({
      profile: z.boolean(),
      identities: z.int().min(0),
      messagesRedacted: z.int().min(0),
    }),
  })
  .meta({ id: 'PrivacyErasure' });

export const PrivacyRequestIdSchema = UuidSchema;
