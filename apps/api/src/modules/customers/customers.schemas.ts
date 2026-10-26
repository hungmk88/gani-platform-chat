import { z } from 'zod';

import {
  CursorQuerySchema,
  cursorPage,
  NullableUuidSchema,
  UuidSchema,
} from '../../openapi/schemas.js';

// The shapes of /v1/customers (J1, Brief P9, N165): one Zod schema validates the request and describes it in OpenAPI.

const at = z.iso.datetime();

export const CustomerSchema = z
  .object({
    id: UuidSchema,
    /** Null until an agent or the channel's profile gives it (a Zalo webhook carries no name). */
    displayName: z.string().nullable(),
    /** E.164 (`+84912345678`); masked (`+8491*****78`) for Marketing and Viewer (Phụ lục B). */
    phone: z.string().nullable(),
    /** Lower case; masked (`l***@example.com`) for Marketing and Viewer. */
    email: z.string().nullable(),
    /** Only a person answers this customer, never the bot (Brief §178). */
    humanOnly: z.boolean(),
    /** How the channels know the customer; never the external id. */
    identities: z.array(
      z
        .object({
          type: z.enum(['zalo_uid']),
          channelAccountId: NullableUuidSchema,
          verification: z.enum(['verified', 'unverified', 'sales_confirmed']),
        })
        .meta({ id: 'CustomerIdentity' }),
    ),
    createdAt: at,
    updatedAt: at,
  })
  .meta({ id: 'Customer' });

export const CustomerPageSchema = cursorPage(CustomerSchema, 'CustomerPage');

export const CustomerListQuerySchema = CursorQuerySchema.extend({
  /** A part of the name, or the start of a phone number (`0912…`, `+84 912…`, from 3 digits). */
  q: z.string().trim().min(1).max(100).optional(),
});
export type CustomerListQuery = z.output<typeof CustomerListQuerySchema>;

export const CustomerIdSchema = UuidSchema;

/**
 * `PATCH /v1/customers/{id}`: what changes, at least one field; null clears it. `phone` is written any usual way (`0912 345 678`,
 * `+84…`) and stored in E.164; one that is not a whole number is 400. `email` is stored in lower case.
 */
export const CustomerChangeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).nullable().optional(),
    phone: z.string().trim().min(1).max(32).nullable().optional(),
    email: z.email().max(254).nullable().optional(),
    humanOnly: z.boolean().optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'CustomerChange' });
export type CustomerChangeBody = z.output<typeof CustomerChangeSchema>;
