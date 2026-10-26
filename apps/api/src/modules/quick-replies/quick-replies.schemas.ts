import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';
import { unknownVariables } from './variables.js';

export const QuickReplyIdSchema = UuidSchema;

/** What is typed after "/" in the Inbox: lower case, digits, `-` and `_` (the CHECK of quick_replies). */
const shortcut = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);
/** Only the variables of Đợt 1 (N163): {{customer_name}}, {{agent_name}}, {{company_name}}, {{company_phone}}. */
const body = z
  .string()
  .max(2000)
  .refine((text) => text.trim() !== '', 'empty')
  .refine((text) => unknownVariables(text).length === 0, 'unknown variable');
const tags = z
  .array(z.string().trim().min(1).max(30))
  .max(10)
  .refine((list) => new Set(list).size === list.length, 'no tag twice');

/** A canned answer of a workspace (C7, N163). */
export const QuickReplySchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    shortcut: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    useCount: z.int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'QuickReply' });
export const QuickReplyListSchema = z
  .object({ data: z.array(QuickReplySchema) })
  .meta({ id: 'QuickReplyList' });

/** `GET /v1/quick-replies?workspaceId=&q=&tag=`: `q` is the start of a shortcut. */
export const QuickReplyListQuerySchema = z
  .object({
    workspaceId: UuidSchema,
    q: z.string().max(32).optional(),
    tag: z.string().max(30).optional(),
  })
  .strict();

/** `POST /v1/quick-replies`. */
export const QuickReplyCreateSchema = z
  .object({ workspaceId: UuidSchema, shortcut, body, tags: tags.optional() })
  .strict()
  .meta({ id: 'QuickReplyCreate' });

/** `PATCH /v1/quick-replies/{id}`: at least one field; the workspace stays. */
export const QuickReplyChangeSchema = z
  .object({ shortcut: shortcut.optional(), body: body.optional(), tags: tags.optional() })
  .strict()
  .refine((change) => Object.keys(change).length > 0, 'nothing to change')
  .meta({ id: 'QuickReplyChange' });

/** `POST /v1/quick-replies/{id}/used`: the count after this use. */
export const QuickReplyUseSchema = z.object({ useCount: z.int() }).meta({ id: 'QuickReplyUse' });

/** `POST /v1/quick-replies/preview` (U38): a template being typed, not yet saved; the body follows the rules of a saved one. */
export const QuickReplyDraftSchema = z
  .object({ workspaceId: UuidSchema, body })
  .strict()
  .meta({ id: 'QuickReplyDraft' });

/** `POST /v1/quick-replies/{id}/preview` and `/preview`: the text with sample values; the variables left without one, in order. */
export const QuickReplyPreviewSchema = z
  .object({ text: z.string(), unresolved: z.array(z.string()) })
  .meta({ id: 'QuickReplyPreview' });
