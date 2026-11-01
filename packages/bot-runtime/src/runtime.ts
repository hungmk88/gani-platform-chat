// BotRuntime.step (D1b1b, Brief P13 "runtime là máy trạng thái chạy trên bot_sessions", N183): one turn of a published flow version, as
// a pure function. It reads the graph, the session's state and what came in (the start of a session, or the customer's message), walks
// the graph node by node and returns the new state, the effects for the caller to carry out (send a message, hand over…) and the steps
// to log. No database, no network, no clock: the worker holds the session's lock, calls this, then writes the result (D1b3). What each
// node type does is a handler (D1b2); this file only walks. A turn stops when a node waits for the customer, when the flow ends or hands
// over, or after MAX_STEPS nodes, so that a loop in a graph never spins.

export const MAX_STEPS = 50;

export interface RuntimeNode {
  readonly key: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
}
export interface RuntimeEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string | null;
}
export interface RuntimeGraph {
  readonly nodes: readonly RuntimeNode[];
  readonly edges: readonly RuntimeEdge[];
}

export type VarValue = string | number | boolean;

/** The state a session keeps between turns (bot_sessions: current_node_key, awaiting, vars). */
export interface SessionState {
  readonly nodeKey: string | null;
  /** What the node `nodeKey` waits for; null when the session is not waiting. */
  readonly awaiting: Readonly<Record<string, unknown>> | null;
  readonly vars: Readonly<Record<string, VarValue>>;
}

export type TurnInput =
  { readonly kind: 'start' } | { readonly kind: 'message'; readonly text: string };

/** Something the caller carries out after the turn; its content is decided by the handlers. */
export interface Effect {
  readonly kind: string;
  readonly [field: string]: unknown;
}

/** One step for bot_session_steps: never free text nor a value (the CHECK of the table), only a label and a variable's name. */
export interface StepRecord {
  readonly nodeKey: string;
  readonly nodeType: string;
  readonly edgeLabel?: string;
  readonly variable?: string;
}

/** What a node decided: go on (by the edge with this label, or the unlabelled one), wait for the customer, end or hand over. */
export type NodeOutcome =
  | { readonly kind: 'next'; readonly label?: string }
  | { readonly kind: 'wait'; readonly awaiting: Readonly<Record<string, unknown>> }
  | { readonly kind: 'end' }
  | { readonly kind: 'handoff' };

export interface NodeResult {
  readonly outcome: NodeOutcome;
  readonly effects?: readonly Effect[];
  readonly vars?: Readonly<Record<string, VarValue>>;
  readonly variable?: string;
}

/** Plain functions, not methods: the runtime calls them detached from the handler object. */
export interface NodeHandler {
  /** The node is reached. */
  readonly enter: (node: RuntimeNode, vars: Readonly<Record<string, VarValue>>) => NodeResult;
  /** The customer answered while the node waited; only for nodes that wait. */
  readonly resume?: (
    node: RuntimeNode,
    awaiting: Readonly<Record<string, unknown>>,
    text: string,
    vars: Readonly<Record<string, VarValue>>,
  ) => NodeResult;
}

export type Handlers = Readonly<Record<string, NodeHandler>>;

/** Thrown by a handler whose node's config it cannot run (the API checks configs on save; this guards older or hand-made graphs). */
export class NodeConfigError extends Error {
  constructor(readonly problem: string) {
    super(`The node's config cannot run: ${problem}.`);
    this.name = 'NodeConfigError';
  }
}

export type TurnStatus = 'active' | 'completed' | 'handed_off' | 'abandoned';

export interface TurnResult {
  readonly status: TurnStatus;
  readonly state: SessionState;
  readonly effects: readonly Effect[];
  readonly steps: readonly StepRecord[];
  /** Why the turn stopped short: the flow is broken or spins; the caller hands the conversation to a person. */
  readonly error?: 'no_trigger' | 'unknown_node' | 'no_handler' | 'bad_config' | 'step_limit';
}

/** The edge that leaves `from`: the one with `label`, else the unlabelled one; null when there is none (the flow ends there). */
function edgeFrom(graph: RuntimeGraph, from: string, label?: string): RuntimeEdge | null {
  const out = graph.edges.filter((e) => e.from === from);
  return (
    (label !== undefined ? out.find((e) => e.label === label) : undefined) ??
    out.find((e) => e.label === null) ??
    null
  );
}

/** One turn of the session `state` of `graph` for `input`, with the node types of `handlers`. */
export function step(
  graph: RuntimeGraph,
  state: SessionState,
  input: TurnInput,
  handlers: Handlers,
): TurnResult {
  const nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  const effects: Effect[] = [];
  const steps: StepRecord[] = [];
  let vars = { ...state.vars };
  const stop = (status: TurnStatus, nodeKey: string | null, error?: TurnResult['error']) => ({
    status,
    state: { nodeKey, awaiting: null, vars },
    effects,
    steps,
    ...(error ? { error } : {}),
  });

  // A handler that throws NodeConfigError abandons the turn with bad_config; any other error is a bug and goes up.
  const run = (fn: () => NodeResult): NodeResult | null => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof NodeConfigError) return null;
      throw error;
    }
  };

  let result: NodeResult | null;
  let node: RuntimeNode | undefined;
  if (input.kind === 'message' && state.nodeKey !== null && state.awaiting !== null) {
    node = nodes.get(state.nodeKey);
    const resume = node ? handlers[node.type]?.resume : undefined;
    if (!node) return stop('abandoned', state.nodeKey, 'unknown_node');
    if (!resume) return stop('abandoned', node.key, 'no_handler');
    const { awaiting } = state;
    result = run(() => resume(node!, awaiting, input.text, vars));
  } else {
    node = graph.nodes.find((n) => n.type === 'trigger');
    if (!node) return stop('abandoned', null, 'no_trigger');
    const handler = handlers[node.type];
    if (!handler) return stop('abandoned', node.key, 'no_handler');
    result = run(() => handler.enter(node!, vars));
  }

  for (;;) {
    if (!result) return stop('abandoned', node.key, 'bad_config');
    effects.push(...(result.effects ?? []));
    vars = { ...vars, ...result.vars };
    const { outcome } = result;
    const edge = outcome.kind === 'next' ? edgeFrom(graph, node.key, outcome.label) : null;
    steps.push({
      nodeKey: node.key,
      nodeType: node.type,
      ...(edge?.label ? { edgeLabel: edge.label } : {}),
      ...(result.variable ? { variable: result.variable } : {}),
    });
    if (outcome.kind === 'wait')
      return {
        status: 'active',
        state: { nodeKey: node.key, awaiting: outcome.awaiting, vars },
        effects,
        steps,
      };
    if (outcome.kind === 'end' || (outcome.kind === 'next' && !edge))
      return stop('completed', node.key);
    if (outcome.kind === 'handoff') return stop('handed_off', node.key);
    if (steps.length >= MAX_STEPS) return stop('abandoned', node.key, 'step_limit');
    node = nodes.get(edge!.to);
    if (!node) return stop('abandoned', edge!.to, 'unknown_node');
    const handler = handlers[node.type];
    if (!handler) return stop('abandoned', node.key, 'no_handler');
    const reached = node;
    result = run(() => handler.enter(reached, vars));
  }
}
