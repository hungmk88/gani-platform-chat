import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';
import { CustomerSchema } from './customers.schemas.js';

// J3, the merge of duplicate customers (Brief P9 lines 443 and 464, N197, N204; CEO 06/11/2026). A merge moves what belongs to the
// source to the target (conversations, identities, tickets, leads, tags, custom field values the target has none of) and keeps a log
// of every row it moved, so an unmerge gives back exactly those rows; what was made after the merge stays with the target. The
// source is never deleted: it is hidden from the lists while it is merged. Only ids go to the audit, never a name, phone or email.

const at = z.iso.datetime();

/** `POST /v1/customers/merge`: the source goes into the target; two different customers. */
export const CustomerMergeSchema = z
  .object({ sourceId: UuidSchema, targetId: UuidSchema })
  .strict()
  .refine((merge) => merge.sourceId !== merge.targetId, {
    message: 'a customer is not merged into itself',
    path: ['targetId'],
  })
  .meta({ id: 'CustomerMerge' });
export type CustomerMergeBody = z.output<typeof CustomerMergeSchema>;

const named = z.object({ id: UuidSchema, name: z.string().nullable() });

/** One merge, as the log keeps it. `unmergedAt` is null while it holds. */
export const CustomerMergeRecordSchema = z
  .object({
    id: UuidSchema,
    sourceId: UuidSchema,
    targetId: UuidSchema,
    /** Who merged; `name` null when they are no longer an active member. */
    mergedBy: named,
    mergedAt: at,
    unmergedAt: at.nullable(),
  })
  .meta({ id: 'CustomerMergeRecord' });

/** The answer of a merge: its record and the target as it is now. */
export const CustomerMergeResultSchema = z
  .object({ merge: CustomerMergeRecordSchema, target: CustomerSchema })
  .meta({ id: 'CustomerMergeResult' });

/** The answer of an unmerge: its record (now with `unmergedAt`) and both customers as they are now. */
export const CustomerUnmergeResultSchema = z
  .object({ merge: CustomerMergeRecordSchema, source: CustomerSchema, target: CustomerSchema })
  .meta({ id: 'CustomerUnmergeResult' });

/** The merges into a customer, newest first, so the profile of the target offers "Tách" (unmerge). */
export const CustomerMergeListSchema = z
  .object({
    data: z.array(
      CustomerMergeRecordSchema.extend({
        /** The source's name as it was kept; null when it had none. */
        sourceName: z.string().nullable(),
      }).meta({ id: 'CustomerMergeEntry' }),
    ),
  })
  .meta({ id: 'CustomerMergeList' });

/** Why a customer is suggested: the same phone (E.164) or the same email, exactly; never a part of one. */
export const MERGE_SUGGESTION_REASONS = ['phone', 'email'] as const;

export const CustomerMergeSuggestionListSchema = z
  .object({
    data: z.array(
      z
        .object({
          customer: CustomerSchema,
          reasons: z.array(z.enum(MERGE_SUGGESTION_REASONS)).min(1),
        })
        .meta({ id: 'CustomerMergeSuggestion' }),
    ),
  })
  .meta({ id: 'CustomerMergeSuggestionList' });
