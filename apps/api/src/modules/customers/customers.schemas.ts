import { z } from 'zod';

import { CursorQuerySchema, cursorPage, UuidSchema } from '../../openapi/schemas.js';

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
          channelAccountId: UuidSchema.nullable(),
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
