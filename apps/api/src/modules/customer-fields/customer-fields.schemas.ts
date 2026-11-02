import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// The custom fields of a company's customers (J1, T-1(a), T-5/U46, U36, CEO 02/11 decision 4 and answers 1 and 4): the contract given
// to the front end before the module is built (S4, planned.ts). A field belongs to the company, shared by every workspace.

const at = z.iso.datetime();
/** At most 50 fields a company (U46, CEO 02/11): the 51st is 422 field_limit_reached. */
export const FIELD_LIMIT = 50;
export const FIELD_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'phone',
  'email',
] as const;
const name = z.string().trim().min(1).max(100);
/** The choices of `select` and `multiselect`: at least two (U46), each named once. */
const options = z
  .array(z.string().trim().min(1).max(100))
  .min(2)
  .max(50)
  .refine((list) => new Set(list).size === list.length, 'no option twice');
const choosing = (type: string | undefined) => type === 'select' || type === 'multiselect';

export const CustomerFieldSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    type: z.enum(FIELD_TYPES),
    /** The choices of `select` and `multiselect`; empty for any other type. */
    options: z.array(z.string()),
    /** The form asks for it; the API still takes a customer without it. */
    required: z.boolean(),
    /** Personal data: Marketing and Viewer read `"••••"` from the API (P8). Kept here, not yet encrypted (CEO 02/11 answer 4). */
    sensitive: z.boolean(),
    /** Hidden: not shown in forms; its values stay. A field with values can only be hidden, not deleted. */
    hidden: z.boolean(),
    position: z.int().min(0),
    /** Some customer has a value: `type` and `sensitive` no longer change, and DELETE is 409 field_has_data. */
    hasData: z.boolean(),
    createdAt: at,
    updatedAt: at,
  })
  .meta({ id: 'CustomerField' });

/** Every field of the company, by position: at most FIELD_LIMIT, so no cursor. */
export const CustomerFieldListSchema = z
  .object({ data: z.array(CustomerFieldSchema) })
  .meta({ id: 'CustomerFieldList' });

export const CustomerFieldCreateSchema = z
  .object({
    name,
    type: z.enum(FIELD_TYPES),
    options: options.optional(),
    required: z.boolean().default(false),
    sensitive: z.boolean().default(false),
  })
  .strict()
  .refine((f) => choosing(f.type) === (f.options !== undefined), {
    message: 'options for select and multiselect, and only for them',
    path: ['options'],
  })
  .meta({ id: 'CustomerFieldCreate' });

/** What changes; `type` and `sensitive` only while no customer has a value (409 field_has_data), as removing an option in use. */
export const CustomerFieldChangeSchema = z
  .object({
    name: name.optional(),
    type: z.enum(FIELD_TYPES).optional(),
    options: options.optional(),
    required: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    hidden: z.boolean().optional(),
    position: z.int().min(0).optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'CustomerFieldChange' });

/** A value as its type reads it: text, phone, email, a `YYYY-MM-DD` date or a choice as a string; a number; choices as a list. */
const value = z
  .union([z.string().max(1000), z.number(), z.array(z.string().max(100)).max(50)])
  .nullable()
  .meta({ id: 'CustomerFieldValue' });

/** A customer's values, one per field that has one; a sensitive one is `"••••"` for Marketing and Viewer. */
export const CustomerFieldValuesSchema = z
  .object({
    data: z.array(z.object({ fieldId: UuidSchema, value }).meta({ id: 'CustomerFieldValueItem' })),
  })
  .meta({ id: 'CustomerFieldValues' });

/** Only the fields sent change; `null` clears one. A value of the wrong type, or not one of the choices, is 422 invalid_field_value. */
export const CustomerFieldValuesChangeSchema = z
  .object({
    values: z
      .array(z.object({ fieldId: UuidSchema, value }).strict())
      .min(1)
      .max(FIELD_LIMIT)
      .refine((list) => new Set(list.map((v) => v.fieldId)).size === list.length, 'no field twice'),
  })
  .strict()
  .meta({ id: 'CustomerFieldValuesChange' });

export const CustomerFieldIdSchema = UuidSchema;
