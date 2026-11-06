import { z } from 'zod';

import {
  CursorQuerySchema,
  cursorPage,
  NullableUuidSchema,
  UuidSchema,
} from '../../openapi/schemas.js';

// The shapes of the leads (Brief P9 lines 443 and 464, U6, T-2, T-3, N188): the contract given to the front end before the module is
// built (S4, planned.ts). The steps of a pipeline and the reasons to lose are data of each workspace (Q9), never written in code.

const at = z.iso.datetime();
const title = z.string().trim().min(1).max(200);

/** Open, then Won or Lost (U6): a lead won or lost is closed for good (T-3). */
export const LEAD_STATUSES = ['open', 'won', 'lost'] as const;
const stage = z.object({ id: UuidSchema, name: z.string() }).meta({ id: 'LeadStage' });
/** A step in an event: null where the event has none (nullable before `meta`, so no `allOf`, U34). */
const eventStage = z
  .object({ id: UuidSchema, name: z.string() })
  .nullable()
  .meta({ id: 'LeadEventStage' });

export const LeadSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    title: z.string(),
    /** A lead is always of a customer; `displayName` null until someone knows it. */
    customer: z
      .object({ id: UuidSchema, displayName: z.string().nullable() })
      .meta({ id: 'LeadCustomer' }),
    /** The conversation it was made from, if any. */
    conversationId: NullableUuidSchema,
    /** The step it is at; for a closed lead, the step it was closed at. */
    stage,
    status: z.enum(LEAD_STATUSES),
    /** Who follows it: `name` null when the person gave none or is no longer an active member. */
    owner: z
      .object({ id: UuidSchema, name: z.string().nullable() })
      .nullable()
      .meta({ id: 'LeadOwner' }),
    /** Who made it: a Sales reads only the leads they made or own (T-2, N188). */
    createdBy: UuidSchema,
    /** One of the workspace's reasons (`GET /v1/workspaces/{id}/pipeline`) when lost; null otherwise. */
    lostReason: z.string().nullable(),
    closedAt: at.nullable(),
    /** Lead scoring is Đợt 2 (Brief F1 step 6): always null until then. */
    score: z.null(),
    /** Sent back with a change: a stale one is 409 version_conflict. */
    version: z.int().min(0),
    createdAt: at,
    updatedAt: at,
  })
  .meta({ id: 'Lead' });

export const LeadEventSchema = z
  .object({
    /** `owner_changed` waits for a way to change the owner (none in Brief P9 yet). */
    type: z.enum(['created', 'stage_changed', 'owner_changed', 'closed']),
    fromStage: eventStage,
    toStage: eventStage,
    /** For `closed` only; the reason of a lost lead is the lead's `lostReason`, no free words here. */
    outcome: z.enum(['won', 'lost']).nullable(),
    actorUserId: NullableUuidSchema,
    occurredAt: at,
  })
  .meta({ id: 'LeadEvent' });

export const LeadDetailSchema = LeadSchema.extend({
  /** Oldest first. */
  events: z.array(LeadEventSchema),
}).meta({ id: 'LeadDetail' });

export const LeadPageSchema = cursorPage(LeadSchema, 'LeadPage');

export const LeadListQuerySchema = CursorQuerySchema.extend({
  /** One of the session's workspaces; absent: all of them. */
  workspaceId: UuidSchema.optional(),
  stageId: UuidSchema.optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  /** `me`, `none` (nobody follows it), or the id of a member. */
  owner: z.union([z.enum(['me', 'none']), UuidSchema]).optional(),
  /** `me` or the id of a member. A Sales still reads only the leads they made or own. */
  createdBy: z.union([z.literal('me'), UuidSchema]).optional(),
  /** The leads of one customer: the Lead tab of the customer's profile (#8). */
  customerId: UuidSchema.optional(),
});

export type LeadListQuery = z.output<typeof LeadListQuerySchema>;

export const LeadCreateSchema = z
  .object({
    workspaceId: UuidSchema,
    customerId: UuidSchema,
    title,
    conversationId: UuidSchema.optional(),
    /** A step of the workspace's pipeline; absent: its first step. Another is 422 invalid_stage. */
    stageId: UuidSchema.optional(),
    /** An active Owner, Admin, Manager or Sales of the workspace; anyone else is 422 invalid_assignee. */
    ownerUserId: UuidSchema.optional(),
  })
  .strict()
  .meta({ id: 'LeadCreate' });

export const LeadStageChangeSchema = z
  .object({ version: z.int().min(0), stageId: UuidSchema })
  .strict()
  .meta({ id: 'LeadStageChange' });

/** Won or Lost, with the `version` last read; a lost lead needs one of the workspace's reasons (G3). */
export const LeadCloseSchema = z
  .object({
    version: z.int().min(0),
    outcome: z.enum(['won', 'lost']),
    lostReason: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((c) => (c.outcome === 'lost') === (c.lostReason !== undefined), {
    message: 'lostReason is required when lost, and only then',
    path: ['lostReason'],
  })
  .meta({ id: 'LeadClose' });

/** The steps of a workspace's pipeline in order, and its reasons to lose a lead (Q9: data of the workspace). */
export const PipelineSchema = z
  .object({
    data: z.array(
      z
        .object({ id: UuidSchema, name: z.string(), position: z.int().min(0) })
        .meta({ id: 'PipelineStage' }),
    ),
    lostReasons: z.array(z.string()),
  })
  .meta({ id: 'Pipeline' });

export const LeadIdSchema = UuidSchema;

export type LeadCreateBody = z.output<typeof LeadCreateSchema>;
export type LeadStageChangeBody = z.output<typeof LeadStageChangeSchema>;
export type LeadCloseBody = z.output<typeof LeadCloseSchema>;
