import { z } from 'zod';

import { CursorQuerySchema, cursorPage, UuidSchema } from '../../openapi/schemas.js';

// The internal notes of a conversation (C6, N194; CEO 04/11/2026): the agents' words, never shown to the customer, never sent to a
// channel. A note never changes and is never deleted in Đợt 1.

/** POST: 1 to 2000 characters once trimmed (the store writes them in NFC). */
export const ConversationNoteCreateSchema = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict()
  .meta({ id: 'ConversationNoteCreate' });

export const ConversationNoteSchema = z
  .object({
    id: UuidSchema,
    conversationId: UuidSchema,
    /** `note`, or `transfer_reason`: the reason given with a transfer, written in the same transaction (N135). */
    kind: z.enum(['note', 'transfer_reason']),
    /** The author; `name` is null for someone who left or has no name. */
    author: z.object({ id: UuidSchema, name: z.string().nullable() }),
    body: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ConversationNote' });

/** Newest first, `?cursor=&limit=` (max 100). */
export const ConversationNotePageSchema = cursorPage(
  ConversationNoteSchema,
  'ConversationNotePage',
);
export const ConversationNoteListQuerySchema = CursorQuerySchema;
