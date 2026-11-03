import { z } from 'zod';

import { UuidSchema } from '../../openapi/schemas.js';

// The scripted bot flows (D1a3, Brief P9 and P13, U63). The config of each node type is the set A approved on 01/11/2026; ai_answer is
// Đợt 2 and is not a type here, so a graph with it is a 400. The API checks the shape; the store checks the graph (one trigger, keys,
// edges, every node reached: 422 bot_flow_graph_invalid).

export const BotFlowIdSchema = UuidSchema;

const text = z.string().trim().min(1).max(2000);
const name = z.string().trim().min(1).max(64);
/** A variable of the session (bot_sessions.vars): lower case, digits and _. */
const variable = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
/** The author's name of a node, unique in its version (the CHECK of bot_nodes). */
const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const configs = {
  trigger: z.object({
    on: z.enum(['first_message', 'keyword', 'intent', 'after_hours']),
    keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(20).optional(),
    intent: name.optional(),
  }),
  message: z.object({ text }),
  question: z.object({
    text,
    kind: z.enum(['text', 'phone', 'number', 'choice']),
    choices: z.array(z.string().trim().min(1).max(50)).min(1).max(10).optional(),
    variable,
  }),
  /** A JSON expression of the automation language (Brief P15). */
  condition: z.object({ expression: z.record(z.string(), z.unknown()) }),
  set_variable: z.object({
    variable,
    value: z.union([z.string().max(500), z.number(), z.boolean()]),
  }),
  collect: z.object({ field: variable }),
  tag: z.object({ tag: z.string().trim().min(1).max(30) }),
  /** A tool registered for the bot; never a free URL (Brief P13). */
  api_call: z.object({ tool: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/) }),
  delay: z.object({ seconds: z.int().min(1).max(86_400) }),
  handoff: z.object({
    reason: z.string().trim().min(1).max(200),
    priority: z.enum(['normal', 'high', 'urgent']),
  }),
  jump_to_flow: z.object({ flowId: UuidSchema }),
  end: z.object({}),
} as const;

const nodeOf = <T extends keyof typeof configs>(type: T) =>
  z.object({ key, type: z.literal(type), config: configs[type].strict() }).strict();

export const BotNodeSchema = z
  .discriminatedUnion('type', [
    nodeOf('trigger'),
    nodeOf('message'),
    nodeOf('question'),
    nodeOf('condition'),
    nodeOf('set_variable'),
    nodeOf('collect'),
    nodeOf('tag'),
    nodeOf('api_call'),
    nodeOf('delay'),
    nodeOf('handoff'),
    nodeOf('jump_to_flow'),
    nodeOf('end'),
  ])
  .meta({ id: 'BotNode' });

export const BotEdgeSchema = z
  .object({ from: key, to: key, label: z.string().trim().min(1).max(100).nullable() })
  .strict()
  .meta({ id: 'BotEdge' });

export const BotGraphSchema = z
  .object({ nodes: z.array(BotNodeSchema).max(200), edges: z.array(BotEdgeSchema).max(400) })
  .strict()
  .meta({ id: 'BotGraph' });

export const BotFlowVersionSchema = z
  .object({
    id: UuidSchema,
    status: z.enum(['draft', 'published']),
    version: z.int().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    graph: BotGraphSchema,
  })
  .meta({ id: 'BotFlowVersion' });

export const BotFlowSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    name: z.string(),
    /** What the flow is for, for the builders (U77 (i)); null when none. */
    description: z.string().nullable(),
    status: z.enum(['draft', 'active', 'inactive']),
    /** The optimistic version of the flow (moves on at each save and publish). */
    version: z.int(),
    /** The number of the latest published version; null when never published. */
    publishedVersion: z.int().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'BotFlow' });

export const BotFlowListSchema = z
  .object({ data: z.array(BotFlowSchema) })
  .meta({ id: 'BotFlowList' });

/** `GET /v1/bot-flows/{id}` and `POST /v1/bot-flows`: the flow, its draft and its latest published version. */
export const BotFlowDetailSchema = BotFlowSchema.extend({
  draft: BotFlowVersionSchema,
  // A union, not .nullable(): a nullable $ref becomes allOf and the generated type loses null (U34).
  published: z.union([BotFlowVersionSchema, z.null()]),
}).meta({ id: 'BotFlowDetail' });

export const BotFlowListQuerySchema = z.object({ workspaceId: UuidSchema }).strict();

const flowName = z.string().trim().min(1).max(100);
/** At most 500 characters like a team's, never blank (U77 (i)). */
const flowDescription = z.string().trim().min(1).max(500);

export const BotFlowCreateSchema = z
  .object({ workspaceId: UuidSchema, name: flowName, description: flowDescription.optional() })
  .strict()
  .meta({ id: 'BotFlowCreate' });

/** `PATCH /v1/bot-flows/{id}` (U77 (i)): rename the flow or change its description (null clears it); at least one of the two. */
export const BotFlowChangeSchema = z
  .object({ name: flowName.optional(), description: flowDescription.nullable().optional() })
  .strict()
  .refine((c) => c.name !== undefined || c.description !== undefined, 'nothing to change')
  .meta({ id: 'BotFlowChange' });
export type BotFlowChange = z.output<typeof BotFlowChangeSchema>;

/** `POST /v1/bot-flows/{id}/dry-run` (D1d, Brief P13): a sample script, as a customer would send it. */
export const BotDryRunSchema = z
  .object({
    version: z.enum(['draft', 'published']).default('draft'),
    messages: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
    /** What `{{customer.name}}` reads; empty text when absent. */
    customerName: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .meta({ id: 'BotDryRun' });

const BotDryRunTurnSchema = z.object({
  /** What the bot would send, as the customer reads it (the choices numbered). */
  replies: z.array(z.object({ nodeKey: z.string(), text: z.string() })),
  steps: z.array(
    z.object({
      nodeKey: z.string(),
      nodeType: z.string(),
      edgeLabel: z.string().optional(),
      variable: z.string().optional(),
    }),
  ),
  /** Who the conversation would go to when the turn stops there (handed over or abandoned); null otherwise. */
  handoff: z.union([
    z.object({ reason: z.string(), priority: z.enum(['normal', 'high', 'urgent']) }),
    z.null(),
  ]),
});

export const BotDryRunResultSchema = z
  .object({
    flowId: UuidSchema,
    version: z.object({
      id: UuidSchema,
      kind: z.enum(['draft', 'published']),
      /** The published number; null for the draft. */
      number: z.int().nullable(),
    }),
    /** Whether the first message fits this flow's trigger (keyword or first message); the run starts the flow either way. */
    triggerMatched: z.boolean(),
    /** The run takes the workspace as in business hours, as the bot does until business hours exist (C8/C10). */
    businessHoursAssumed: z.literal(true),
    status: z.enum(['active', 'completed', 'handed_off', 'abandoned']),
    /** Why the flow stopped short: a code, never a message. */
    error: z
      .enum([
        'no_trigger',
        'unknown_node',
        'no_handler',
        'bad_config',
        'step_limit',
        'jump_target',
        'jump_limit',
      ])
      .nullable(),
    turns: z.array(BotDryRunTurnSchema),
    vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    /** Messages of the script left over after the session stopped. */
    unusedMessages: z.int(),
  })
  .meta({ id: 'BotDryRunResult' });
