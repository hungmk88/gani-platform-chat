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

export const BotFlowCreateSchema = z
  .object({ workspaceId: UuidSchema, name: z.string().trim().min(1).max(100) })
  .strict()
  .meta({ id: 'BotFlowCreate' });
