import { CONVERSATION_OUTCOMES, CONVERSATION_STATES } from '@gani/domain';
import { z } from 'zod';

import { CursorQuerySchema, cursorPage, UuidSchema } from '../../openapi/schemas.js';

// The shapes of /v1/conversations (Brief P9): one Zod schema validates the request (ZodPipe) and describes it in OpenAPI, so the two
// cannot drift. Responses are camelCase; dates are ISO 8601 in UTC.

const at = z.iso.datetime();

export const ConversationSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    state: z.enum(CONVERSATION_STATES),
    afterHoursHold: z.boolean(),
    assignedUserId: UuidSchema.nullable(),
    /** What a person's action sends back as `version` (FSM spec §6): a stale one is 409 version_conflict. */
    version: z.number().int().min(0),
    outcome: z.enum(CONVERSATION_OUTCOMES).nullable(),
    closedAt: at.nullable(),
    lastMessageAt: at.nullable(),
    lastCustomerMessageAt: at.nullable(),
    createdAt: at,
  })
  .meta({ id: 'Conversation' });

export const MessageSchema = z
  .object({
    id: UuidSchema,
    sequenceNumber: z.number().int().min(1),
    senderKind: z.enum(['customer', 'agent', 'bot', 'system']),
    senderUserId: UuidSchema.nullable(),
    kind: z.enum(['text', 'image', 'file', 'sticker', 'postback', 'system']),
    body: z.string().nullable(),
    platformSentAt: at.nullable(),
    createdAt: at,
  })
  .meta({ id: 'Message' });

export const ConversationPageSchema = cursorPage(ConversationSchema, 'ConversationPage');
export const MessagePageSchema = cursorPage(MessageSchema, 'MessagePage');

export const ConversationListQuerySchema = CursorQuerySchema.extend({
  /** One of the session's workspaces; absent: all of them. */
  workspaceId: UuidSchema.optional(),
  state: z.enum(CONVERSATION_STATES).optional(),
  /** `true`: out of hours, held for the bot (the "HOLD" filter of the Inbox). */
  hold: z.enum(['true', 'false']).optional(),
  /** `me`: assigned to me; `none`: unassigned; `any` (default): everything the role may see. */
  assignee: z.enum(['me', 'none', 'any']).default('any'),
});
export type ConversationListQuery = z.output<typeof ConversationListQuerySchema>;

export const ConversationIdSchema = UuidSchema;
export const MessageListQuerySchema = CursorQuerySchema;
