import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// The tags of an organisation (J4, T-4/U47, U36, CEO 02/11 decision 4): the contract given to the front end before the module is
// built (S4, planned.ts). A tag belongs to the company, not to a workspace; a tag on an Inbox line is the customer's tag (T-4).

const at = z.iso.datetime();
/** At most 500 tags a company (CEO 02/11): the 501st is 422 tag_limit_reached. */
export const TAG_LIMIT = 500;
const name = z.string().trim().min(1).max(50);

export const TagSchema = z
  .object({
    id: UuidSchema,
    /** Unique in the company, whatever the case: another with the same name is 409 duplicate_resource. */
    name: z.string(),
    /** Hidden: no customer gets it any more; those who have it keep it, and it still filters (T-4). */
    hidden: z.boolean(),
    customerCount: z.int().min(0),
    createdAt: at,
    updatedAt: at,
  })
  .meta({ id: 'Tag' });

/** Every tag of the company, by name: at most TAG_LIMIT, so no cursor. */
export const TagListSchema = z.object({ data: z.array(TagSchema) }).meta({ id: 'TagList' });

export const TagCreateSchema = z.object({ name }).strict().meta({ id: 'TagCreate' });

export const TagChangeSchema = z
  .object({ name: name.optional(), hidden: z.boolean().optional() })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'TagChange' });

/** Move every customer of this tag to `intoTagId`, then delete this tag (audited `tag.merged`). */
export const TagMergeSchema = z.object({ intoTagId: UuidSchema }).strict().meta({ id: 'TagMerge' });

export const TagMergeResultSchema = z
  .object({
    /** Customers that had this tag and not yet the other: none is lost, none counted twice. */
    movedCount: z.int().min(0),
    /** The tag that stays, hidden or not as it was: a customer keeps it even when it is hidden (T-4). */
    into: TagSchema,
  })
  .meta({ id: 'TagMergeResult' });

/** The whole set of a customer's tags: a hidden tag the customer has stays; a hidden tag added is 422 tag_hidden (T-4). */
export const CustomerTagsChangeSchema = z
  .object({
    tagIds: z
      .array(UuidSchema)
      .max(TAG_LIMIT)
      .refine((ids) => new Set(ids).size === ids.length, 'no tag twice'),
  })
  .strict()
  .meta({ id: 'CustomerTagsChange' });

/** A tag of a customer (Customer.tags, N190): hidden ones too, a customer keeps a tag that was hidden after (T-4). */
export const CustomerTagSchema = z
  .object({ id: UuidSchema, name: z.string(), hidden: z.boolean() })
  .meta({ id: 'CustomerTag' });

export const CustomerTagsSchema = z
  .object({ data: z.array(CustomerTagSchema) })
  .meta({ id: 'CustomerTags' });

export const TagIdSchema = UuidSchema;
