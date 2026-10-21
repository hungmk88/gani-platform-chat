import { CONVERSATION_OUTCOMES, CONVERSATION_STATES } from '@gani/domain';
import { z } from 'zod';

import { CursorQuerySchema, cursorPage, ProblemSchema, UuidSchema } from '../../openapi/schemas.js';

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

/** The body of an action of a person (FSM spec §6): the `version` of the conversation the client last read. */
export const VersionBodySchema = z
  .object({ version: z.number().int().min(0) })
  .strict()
  .meta({ id: 'VersionBody' });

/** Transfer and assign: to whom. A member of the conversation's workspace who may hold conversations, or 422 invalid_assignee. */
export const AssigneeBodySchema = z
  .object({ version: z.number().int().min(0), toUserId: UuidSchema })
  .strict()
  .meta({ id: 'AssigneeBody' });

/** Close (T13): the outcome is required (Brief P14); won or lost belong to the lead, not here. */
export const CloseBodySchema = z
  .object({
    version: z.number().int().min(0),
    outcome: z.enum(['resolved', 'no_response', 'spam']),
  })
  .strict()
  .meta({ id: 'CloseBody' });

/** 409 of a claim that lost: who holds the conversation now (PRR-05). */
export const ClaimConflictSchema = ProblemSchema.extend({
  code: z.literal('conversation_already_claimed'),
  assignedUserId: UuidSchema.nullable(),
}).meta({ id: 'ClaimConflictProblem' });
