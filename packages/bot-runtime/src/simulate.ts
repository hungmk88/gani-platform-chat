// What the worker and the dry-run share around BotRuntime.step (D1d, Brief P13): the jumps from flow to flow in one turn, and a bot
// message as the customer reads it; and the dry-run itself, a sample script run through the same steps with no database write and
// no channel. The caller gives the published graphs of the other flows (`resolveFlow`): this file reads nothing on its own.

import type {
  Effect,
  Handlers,
  RuntimeGraph,
  StepRecord,
  TurnResult,
  TurnStatus,
} from './runtime.js';
import { step } from './runtime.js';

/** Jumps from flow to flow in one turn before the session is abandoned (jump_limit). */
export const MAX_JUMPS = 3;

/** The published version of a flow of the workspace the jump goes to; null when it is not there (deleted, inactive, unpublished). */
export type ResolveFlow = (
  flowId: string,
) => Promise<{ readonly versionId: string; readonly graph: RuntimeGraph } | null>;

export type TurnProblem = NonNullable<TurnResult['error']> | 'jump_target' | 'jump_limit';

export interface JumpedTurn {
  readonly turn: TurnResult;
  /** The version the session goes on in, when the turn jumped to another flow; null when it stays in its own. */
  readonly target: { readonly versionId: string; readonly graph: RuntimeGraph } | null;
  readonly problem?: TurnProblem;
}

/**
 * jump_to_flow (D1b3b): a turn that ends on a jump goes on at the trigger of the other flow's published version, with the session's
 * variables; at most MAX_JUMPS a turn, so two flows that jump to each other never spin. A flow that is not there abandons the turn
 * (jump_target), and so does one jump too many (jump_limit); the flow is not even looked up then.
 */
export async function followJumps(
  first: TurnResult,
  handlers: Handlers,
  resolveFlow: ResolveFlow,
): Promise<JumpedTurn> {
  let turn = first;
  let target: JumpedTurn['target'] = null;
  let problem: TurnProblem | undefined = turn.error;
  for (let jumps = 0; turn.status === 'completed'; jumps++) {
    const jump = turn.effects.find((e) => e.kind === 'jump');
    if (!jump) break;
    const next = jumps < MAX_JUMPS ? await resolveFlow(String(jump.flowId)) : null;
    if (!next) {
      problem = jumps < MAX_JUMPS ? 'jump_target' : 'jump_limit';
      turn = { ...turn, status: 'abandoned' };
      break;
    }
    target = next;
    const after = step(
      next.graph,
      { nodeKey: null, awaiting: null, vars: turn.state.vars },
      { kind: 'start' },
      handlers,
    );
    problem = after.error;
    turn = {
      ...after,
      effects: [...turn.effects.filter((e) => e.kind !== 'jump'), ...after.effects],
      steps: [...turn.steps, ...after.steps],
    };
  }
  return { turn, target, ...(problem ? { problem } : {}) };
}

/** A send effect as the customer reads it: the choices of a question numbered under its text, so "2" answers it. */
export function replyText(effect: Effect): string {
  const choices = Array.isArray(effect.choices) ? effect.choices.map(String) : [];
  return [String(effect.text), ...choices.map((c, i) => `${i + 1}. ${c}`)].join('\n');
}

/** Why a turn that stopped goes to a person: the handoff node's reason and priority, else the problem, else bot_abandoned. */
export function handoffOf(
  turn: TurnResult,
  problem?: string,
): { readonly reason: string; readonly priority?: unknown } {
  const asked = turn.effects.find((e) => e.kind === 'handoff');
  const reason = typeof asked?.reason === 'string' ? asked.reason : (problem ?? 'bot_abandoned');
  return asked?.priority === undefined ? { reason } : { reason, priority: asked.priority };
}

export interface SimulatedTurn {
  readonly replies: readonly { readonly nodeKey: string; readonly text: string }[];
  readonly steps: readonly StepRecord[];
  readonly handoff?: { readonly reason: string; readonly priority?: unknown };
}

export interface Simulation {
  readonly status: TurnStatus;
  readonly error?: TurnProblem;
  readonly turns: readonly SimulatedTurn[];
  readonly vars: TurnResult['state']['vars'];
  /** Messages of the script left over after the session stopped. */
  readonly unusedMessages: number;
}

/**
 * The dry-run (Brief P13): `messages` as a customer would send them, the first one starting the flow (as a message that chose it)
 * and each next one answering the node that waits, until the session stops or the script runs out. Each message is one turn of the
 * worker's, jumps included; a turn that stops reports the person it would go to. Nothing is sent and nothing is written.
 */
export async function simulate(input: {
  readonly graph: RuntimeGraph;
  readonly messages: readonly string[];
  readonly handlers: Handlers;
  readonly resolveFlow: ResolveFlow;
}): Promise<Simulation> {
  let graph = input.graph;
  let state: TurnResult['state'] = { nodeKey: null, awaiting: null, vars: {} };
  const turns: SimulatedTurn[] = [];
  for (const [i, text] of input.messages.entries()) {
    const first = step(
      graph,
      state,
      i === 0 ? { kind: 'start' } : { kind: 'message', text },
      input.handlers,
    );
    const { turn, target, problem } = await followJumps(first, input.handlers, input.resolveFlow);
    if (target) graph = target.graph;
    state = turn.state;
    const stopped = turn.status === 'handed_off' || turn.status === 'abandoned';
    turns.push({
      replies: turn.effects
        .filter((e) => e.kind === 'send')
        .map((e) => ({ nodeKey: String(e.node), text: replyText(e) })),
      steps: turn.steps,
      ...(stopped ? { handoff: handoffOf(turn, problem) } : {}),
    });
    if (turn.status !== 'active')
      return {
        status: turn.status,
        ...(problem ? { error: problem } : {}),
        turns,
        vars: state.vars,
        unusedMessages: input.messages.length - i - 1,
      };
  }
  return { status: 'active', turns, vars: state.vars, unusedMessages: 0 };
}
