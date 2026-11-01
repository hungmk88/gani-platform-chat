import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { botEdges, botFlowVersions, botFlows, botNodes } from './schema/bot-flows.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// The scripted bot flows of a workspace and their graphs (D1a2a, Brief P13, N178). Row-level security keeps them to the transaction's
// organisation; who may write them (an Owner, an Admin or a Manager) and whether the workspace is the session's are the caller's
// checks (D1a3). Nothing is deleted (spec RLS M01 §2, option (a)): saving a draft gives the old draft up (discarded) and writes the
// whole graph as a new draft version, so a graph is written once (BF001 refuses it afterwards).

/** The node types of Đợt 1 (Brief P13), the list of the schema and of bot_nodes_type_check. */
export type BotNodeType = (typeof botNodes.type.enumValues)[number];

/** A node of a graph, named by the author's key. `config` is checked by type in the API (D1a3) and never logged. */
export interface BotGraphNode {
  readonly key: string;
  readonly type: BotNodeType;
  readonly config: Readonly<Record<string, unknown>>;
}
/** An edge between two node keys of the same graph; `label` names the branch. */
export interface BotGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
}
export interface BotGraph {
  readonly nodes: readonly BotGraphNode[];
  readonly edges: readonly BotGraphEdge[];
}

type Flow = typeof botFlows.$inferSelect;
type Version = typeof botFlowVersions.$inferSelect;
export type BotFlowRow = Pick<
  Flow,
  'id' | 'workspaceId' | 'name' | 'status' | 'version' | 'createdAt' | 'updatedAt'
>;
export type BotFlowVersionRow = Pick<
  Version,
  'id' | 'flowId' | 'status' | 'version' | 'publishedAt'
> & {
  readonly graph: BotGraph;
};

/** Why a graph cannot be saved: never the content of a node, only which rule it breaks. */
export type BotGraphProblem =
  'trigger_count' | 'duplicate_key' | 'unknown_node' | 'unreachable_node';

export class BotGraphInvalidError extends Error {
  constructor(readonly problem: BotGraphProblem) {
    super(`the bot flow graph is invalid: ${problem}`);
    this.name = 'BotGraphInvalidError';
  }
}

/** The flow is not one of the transaction's organisation, or it is deleted. */
export class BotFlowNotFoundError extends Error {
  constructor() {
    super('no such bot flow');
    this.name = 'BotFlowNotFoundError';
  }
}

/**
 * The problem of `graph`, or null when it can be saved: exactly one trigger, keys unique, every edge between two of its nodes, and
 * every node reached from the trigger (stricter than "no orphan": a loop cut off from the trigger has edges in, yet never runs).
 */
export function botGraphProblem(graph: BotGraph): BotGraphProblem | null {
  const keys = new Set(graph.nodes.map((n) => n.key));
  if (keys.size !== graph.nodes.length) return 'duplicate_key';
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) return 'trigger_count';
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!keys.has(e.from) || !keys.has(e.to)) return 'unknown_node';
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  const reached = new Set<string>([triggers[0]!.key]);
  const todo = [triggers[0]!.key];
  for (let key = todo.pop(); key !== undefined; key = todo.pop())
    for (const to of next.get(key) ?? [])
      if (!reached.has(to)) {
        reached.add(to);
        todo.push(to);
      }
  return reached.size === keys.size ? null : 'unreachable_node';
}

const flowColumns = {
  id: botFlows.id,
  workspaceId: botFlows.workspaceId,
  name: botFlows.name,
  status: botFlows.status,
  version: botFlows.version,
  createdAt: botFlows.createdAt,
  updatedAt: botFlows.updatedAt,
};

/** The live flow `id`, locked until the end of the transaction, or null. */
export async function lockBotFlow(tx: TenantTx, id: string): Promise<BotFlowRow | null> {
  const [row] = await tx
    .select(flowColumns)
    .from(botFlows)
    .where(and(eq(botFlows.id, assertUuid(id, 'id')), isNull(botFlows.deletedAt)))
    .for('update');
  return row ?? null;
}

/** Makes a flow in a workspace of the organisation, with an empty draft version (not publishable until a graph is saved). */
export async function createBotFlow(
  tx: TenantTx,
  q: {
    readonly workspaceId: string;
    readonly name: string;
    readonly createdBy: string;
    readonly newId: () => string;
  },
): Promise<{ flow: BotFlowRow; draftVersionId: string }> {
  const { orgId } = currentTenantContext();
  const [id, draftVersionId] = [assertUuid(q.newId(), 'newId'), assertUuid(q.newId(), 'newId')];
  const createdBy = assertUuid(q.createdBy, 'createdBy');
  await tx.insert(botFlows).values({
    id,
    orgId,
    workspaceId: assertUuid(q.workspaceId, 'workspaceId'),
    name: q.name,
    createdBy,
  });
  await tx.insert(botFlowVersions).values({ id: draftVersionId, orgId, flowId: id, createdBy });
  return { flow: (await lockBotFlow(tx, id)) as BotFlowRow, draftVersionId };
}

/** Inserts `graph` as the nodes and edges of the draft version `versionId`. */
async function insertGraph(
  tx: TenantTx,
  versionId: string,
  graph: BotGraph,
  newId: () => string,
): Promise<void> {
  const { orgId } = currentTenantContext();
  const ids = new Map(graph.nodes.map((n) => [n.key, assertUuid(newId(), 'newId')]));
  await tx.insert(botNodes).values(
    graph.nodes.map((n) => ({
      id: ids.get(n.key)!,
      orgId,
      versionId,
      key: n.key,
      type: n.type,
      config: n.config,
    })),
  );
  if (graph.edges.length === 0) return;
  await tx.insert(botEdges).values(
    graph.edges.map((e) => ({
      id: assertUuid(newId(), 'newId'),
      orgId,
      versionId,
      fromNodeId: ids.get(e.from)!,
      toNodeId: ids.get(e.to)!,
      label: e.label,
    })),
  );
}

/**
 * Saves `graph` as the new draft of the flow: the flow is locked, its draft given up (discarded), the graph written as a new draft
 * version, and the flow's version moves on. BotGraphInvalidError before anything is written; BotFlowNotFoundError for no live flow.
 */
export async function saveBotFlowDraft(
  tx: TenantTx,
  q: {
    readonly flowId: string;
    readonly graph: BotGraph;
    readonly savedBy: string;
    readonly newId: () => string;
  },
): Promise<{ flow: BotFlowRow; draftVersionId: string }> {
  const problem = botGraphProblem(q.graph);
  if (problem) throw new BotGraphInvalidError(problem);
  const flowId = assertUuid(q.flowId, 'flowId');
  if (!(await lockBotFlow(tx, flowId))) throw new BotFlowNotFoundError();
  await tx
    .update(botFlowVersions)
    .set({ status: 'discarded', updatedAt: sql`now()` })
    .where(and(eq(botFlowVersions.flowId, flowId), eq(botFlowVersions.status, 'draft')));
  const draftVersionId = assertUuid(q.newId(), 'newId');
  await tx.insert(botFlowVersions).values({
    id: draftVersionId,
    orgId: currentTenantContext().orgId,
    flowId,
    createdBy: assertUuid(q.savedBy, 'savedBy'),
  });
  await insertGraph(tx, draftVersionId, q.graph, q.newId);
  await tx
    .update(botFlows)
    .set({ version: sql`${botFlows.version} + 1`, updatedAt: sql`now()` })
    .where(eq(botFlows.id, flowId));
  return { flow: (await lockBotFlow(tx, flowId)) as BotFlowRow, draftVersionId };
}

/** The version `id` with its graph (nodes and edges in key order), or null when it is not one of the organisation's. */
export async function loadBotFlowVersion(
  tx: TenantTx,
  id: string,
): Promise<BotFlowVersionRow | null> {
  const versionId = assertUuid(id, 'id');
  const [row] = await tx
    .select({
      id: botFlowVersions.id,
      flowId: botFlowVersions.flowId,
      status: botFlowVersions.status,
      version: botFlowVersions.version,
      publishedAt: botFlowVersions.publishedAt,
    })
    .from(botFlowVersions)
    .where(eq(botFlowVersions.id, versionId));
  if (!row) return null;
  const nodes = await tx
    .select({ id: botNodes.id, key: botNodes.key, type: botNodes.type, config: botNodes.config })
    .from(botNodes)
    .where(eq(botNodes.versionId, versionId))
    .orderBy(asc(botNodes.key));
  const keyOf = new Map(nodes.map((n) => [n.id, n.key]));
  const edges = await tx
    .select({ from: botEdges.fromNodeId, to: botEdges.toNodeId, label: botEdges.label })
    .from(botEdges)
    .where(eq(botEdges.versionId, versionId));
  const byKeys = (e: BotGraphEdge) => `${e.from}\u0000${e.to}\u0000${e.label ?? ''}`;
  return {
    ...row,
    graph: {
      nodes: nodes.map((n) => ({
        key: n.key,
        type: n.type,
        config: n.config as Record<string, unknown>,
      })),
      edges: edges
        .map((e) => ({ from: keyOf.get(e.from)!, to: keyOf.get(e.to)!, label: e.label }))
        .sort((x, y) => (byKeys(x) < byKeys(y) ? -1 : 1)),
    },
  };
}
