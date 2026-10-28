import { z } from 'zod';

import {
  CursorQuerySchema,
  cursorPage,
  NullableUuidSchema,
  UuidSchema,
} from '../../openapi/schemas.js';

// The shapes of /v1/tickets (U27, #14/#15): the contract given to the front end before the module is built (S4, planned.ts). The
// controller will validate with these same schemas, as every module does.

const at = z.iso.datetime();

/** The five states of a ticket (U27, CEO 26/10/2026). */
export const TICKET_STATUSES = [
  'new',
  'in_progress',
  'waiting_customer',
  'done',
  'cancelled',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Where a ticket may go from each state (N167). `done` may be reopened; `cancelled` is final. Only an Owner, an Admin or a Manager may
 * cancel (U27). Any other move is 409 invalid_transition.
 */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: ['in_progress', 'cancelled'],
  in_progress: ['waiting_customer', 'done', 'cancelled'],
  waiting_customer: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: [],
};

/** The three levels of C8: Thường, Cao, Khẩn. */
const priority = z.enum(['normal', 'high', 'urgent']);
const named = z.object({ id: UuidSchema, name: z.string() });

export const TicketSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(TICKET_STATUSES),
    priority,
    /** The kind of ticket and its SLA wait for The Smile (Q8): null until then. */
    type: z.string().nullable(),
    customer: z
      .object({ id: UuidSchema, displayName: z.string().nullable() })
      .nullable()
      .meta({ id: 'TicketCustomer' }),
    /** The conversation it was made from, if any. */
    conversationId: NullableUuidSchema,
    assignee: named.nullable().meta({ id: 'TicketAssignee' }),
    /** The clock stops while the ticket waits for the customer (U27) and out of hours (Q7). Null until SLA exists (Q7, Q8). */
    sla: z
      .object({
        dueAt: at,
        pausedReason: z.enum(['waiting_customer', 'outside_hours']).nullable(),
      })
      .nullable()
      .meta({ id: 'TicketSla' }),
    /** Sent back with a change: a stale one is 409 version_conflict. */
    version: z.int().min(0),
    createdBy: UuidSchema,
    createdAt: at,
    updatedAt: at,
  })
  .meta({ id: 'Ticket' });

export const TicketEventSchema = z
  .object({
    type: z.enum(['created', 'status_changed', 'assigned', 'edited']),
    fromStatus: z.enum(TICKET_STATUSES).nullable(),
    toStatus: z.enum(TICKET_STATUSES).nullable(),
    actorUserId: NullableUuidSchema,
    occurredAt: at,
  })
  .meta({ id: 'TicketEvent' });

export const TicketDetailSchema = TicketSchema.extend({
  /** Oldest first. */
  events: z.array(TicketEventSchema),
}).meta({ id: 'TicketDetail' });

export const TicketPageSchema = cursorPage(TicketSchema, 'TicketPage');

export const TicketListQuerySchema = CursorQuerySchema.extend({
  /** One of the session's workspaces; absent: all of them. */
  workspaceId: UuidSchema.optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  /** `me`, `none` (unassigned), or the id of a member. */
  assignee: z.union([z.enum(['me', 'none']), UuidSchema]).optional(),
  /** The tickets of one conversation (U53, N170); a Sales still sees only the ones they made. */
  conversationId: UuidSchema.optional(),
});

export const TicketCreateSchema = z
  .object({
    workspaceId: UuidSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    priority: priority.default('normal'),
    customerId: UuidSchema.optional(),
    conversationId: UuidSchema.optional(),
    /** An Owner, Admin, Manager or Support of the workspace (U52, N170); anyone else is 422 invalid_assignee. */
    assigneeUserId: UuidSchema.optional(),
  })
  .strict()
  .meta({ id: 'TicketCreate' });

/** What changes, with the `version` last read; at least one field besides it. `null` clears the description or the assignee. */
export const TicketChangeSchema = z
  .object({
    version: z.int().min(0),
    status: z.enum(TICKET_STATUSES).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: priority.optional(),
    assigneeUserId: NullableUuidSchema.optional(),
  })
  .strict()
  .refine((change) => Object.keys(change).length > 1, 'nothing to change')
  .meta({ id: 'TicketChange' });

export const TicketIdSchema = UuidSchema;
