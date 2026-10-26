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
    /**
     * The customer (N165): null until the inbound worker names them. `displayName` is null until an agent or the channel's profile gives
     * it (the Zalo webhook carries no name): the Inbox then shows a label of its own.
     */
    customer: z
      .object({ id: UuidSchema, displayName: z.string().nullable() })
      .nullable()
      .meta({ id: 'ConversationCustomer' }),
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
    /**
     * A message of the account to the channel: `pending` until the outbound worker sends it (N146); null for the others. Every REST
     * answer has it; optional because the packets of the socket (realtime spec §3) do not carry it yet.
     */
    deliveryStatus: z.enum(['pending', 'sent', 'failed']).nullable().optional(),
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

/** What an agent says to the customer (N146): text only in Đợt 1 (N100(7)); the limit of Zalo is not verified yet (Z6). */
export const SendMessageBodySchema = z
  .object({ text: z.string().trim().min(1).max(2000) })
  .strict()
  .meta({ id: 'SendMessageBody' });

/** 422 of a send the channel may not carry now (channel-policy-spec §3): the state of the window and why. */
export const WindowClosedSchema = ProblemSchema.extend({
  code: z.literal('channel_window_closed'),
  windowState: z.enum(['paid_only', 'api_closed']),
  reason: z.enum([
    'no_customer_message',
    'no_free_window',
    'window_expired',
    'quota_exhausted',
    'no_policy',
  ]),
}).meta({ id: 'WindowClosedProblem' });

/** 409 of a claim that lost: who holds the conversation now (PRR-05). */
export const ClaimConflictSchema = ProblemSchema.extend({
  code: z.literal('conversation_already_claimed'),
  assignedUserId: UuidSchema.nullable(),
}).meta({ id: 'ClaimConflictProblem' });
