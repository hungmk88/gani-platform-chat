import { describe, expect, it, vi } from 'vitest';

import { coreHandlers } from './nodes.js';
import { MAX_STEPS, step, type RuntimeGraph } from './runtime.js';
import {
  followJumps,
  handoffOf,
  MAX_JUMPS,
  replyText,
  simulate,
  type ResolveFlow,
} from './simulate.js';

// The jumps, the reply text and the dry-run over the real node types (D1d). The worker's turn uses the same followJumps and
// replyText (apps/worker/src/inbound/bot-turn.test.ts keeps its own cases unchanged).
const handlers = coreHandlers({ customer: { name: 'Lan' }, workspace: { isBusinessHours: true } });
const n = (key: string, type: string, config: Record<string, unknown> = {}) => ({
  key,
  type,
  config,
});
const e = (from: string, to: string, label: string | null = null) => ({ from, to, label });
const OTHER = '0190a000-0000-7000-8000-000000000002';
const ORDER: RuntimeGraph = {
  nodes: [
    n('start', 'trigger', { on: 'keyword', keywords: ['đặt'] }),
    n('hi', 'message', { text: 'Chào {{customer.name}}' }),
    n('pack', 'question', {
      text: 'Loại?',
      kind: 'choice',
      choices: ['Hộp', 'Thùng'],
      variable: 'pack',
    }),
    n('qty', 'question', { text: 'Bao nhiêu?', kind: 'number', variable: 'qty' }),
    n('done', 'end'),
    n('human', 'handoff', { reason: 'big_order', priority: 'high' }),
  ],
  edges: [
    e('start', 'hi'),
    e('hi', 'pack'),
    e('pack', 'human', 'Thùng'),
    e('pack', 'qty'),
    e('qty', 'done'),
  ],
};
const JUMPER: RuntimeGraph = {
  nodes: [
    n('start', 'trigger', { on: 'first_message' }),
    n('mark', 'set_variable', { variable: 'from', value: 'jumper' }),
    n('bye', 'message', { text: 'Chuyển nhé' }),
    n('go', 'jump_to_flow', { flowId: OTHER }),
  ],
  edges: [e('start', 'mark'), e('mark', 'bye'), e('bye', 'go')],
};
const resolveTo =
  (graph: RuntimeGraph | null): ResolveFlow =>
  () =>
    Promise.resolve(graph && { versionId: 'v2', graph });
const run = (graph: RuntimeGraph, messages: string[], resolveFlow = resolveTo(null)) =>
  simulate({ graph, messages, handlers, resolveFlow });

describe('simulate', () => {
  it('starts on the first message, answers with the next ones, and stops when the flow ends', async () => {
    const sim = await run(ORDER, ['đặt hàng', '1', 'mười', '12']);
    expect(sim.status).toBe('completed');
    expect(sim.unusedMessages).toBe(0);
    expect(sim.vars).toEqual({ pack: 'Hộp', qty: 12 });
    expect(sim.turns).toHaveLength(4);
    // The first message only starts the flow: it is not an answer to anything.
    expect(sim.turns[0]!.replies).toEqual([
      { nodeKey: 'hi', text: 'Chào Lan' },
      { nodeKey: 'pack', text: 'Loại?\n1. Hộp\n2. Thùng' },
    ]);
    expect(sim.turns[1]!.steps.map((s) => s.nodeKey)).toEqual(['pack', 'qty']);
    // A wrong answer asks again; the right one ends.
    expect(sim.turns[2]!.replies).toEqual([{ nodeKey: 'qty', text: 'Bao nhiêu?' }]);
    expect(sim.turns[3]!.steps.map((s) => s.nodeKey)).toEqual(['qty', 'done']);
    expect(sim.turns.some((t) => t.handoff)).toBe(false);
  });

  it('counts the messages left over once the session stops, and says who it hands over to', async () => {
    const sim = await run(ORDER, ['đặt', 'Thùng', 'còn nữa', 'và nữa']);
    expect(sim.status).toBe('handed_off');
    expect(sim.turns).toHaveLength(2);
    expect(sim.unusedMessages).toBe(2);
    expect(sim.turns[1]!.handoff).toEqual({ reason: 'big_order', priority: 'high' });
  });

  it('stays active when the script runs out while a node waits', async () => {
    const sim = await run(ORDER, ['đặt']);
    expect(sim).toMatchObject({ status: 'active', unusedMessages: 0 });
    expect(sim).not.toHaveProperty('error');
  });

  it('follows a jump into the other flow, and goes on there with the next message', async () => {
    const resolveFlow = vi.fn(resolveTo(ORDER));
    const sim = await run(JUMPER, ['xin chào', '1', '3'], resolveFlow);
    expect(resolveFlow).toHaveBeenCalledWith(OTHER);
    expect(sim.status).toBe('completed');
    expect(sim.vars).toEqual({ from: 'jumper', pack: 'Hộp', qty: 3 });
    expect(sim.turns[0]!.steps.map((s) => s.nodeKey)).toEqual([
      'start',
      'mark',
      'bye',
      'go',
      'start',
      'hi',
      'pack',
    ]);
    expect(sim.turns[0]!.replies.map((r) => r.nodeKey)).toEqual(['bye', 'hi', 'pack']);
  });

  it('reports a broken flow as abandoned with its code and the person it goes to', async () => {
    const lost = await run(JUMPER, ['a', 'b']);
    expect(lost).toMatchObject({ status: 'abandoned', error: 'jump_target', unusedMessages: 1 });
    expect(lost.turns[0]!.handoff).toEqual({ reason: 'jump_target' });
    const empty = await run({ nodes: [], edges: [] }, ['a']);
    expect(empty).toMatchObject({ status: 'abandoned', error: 'no_trigger' });
  });
});

describe('followJumps', () => {
  const start = (graph: RuntimeGraph) =>
    step(graph, { nodeKey: null, awaiting: null, vars: {} }, { kind: 'start' }, handlers);

  it('leaves a turn without a jump as it is', async () => {
    const turn = start(ORDER);
    const resolveFlow = vi.fn(resolveTo(ORDER));
    expect(await followJumps(turn, handlers, resolveFlow)).toEqual({ turn, target: null });
    expect(resolveFlow).not.toHaveBeenCalled();
    const ended = start({
      nodes: [n('start', 'trigger'), n('done', 'end')],
      edges: [e('start', 'done')],
    });
    expect(ended.status).toBe('completed');
    expect(await followJumps(ended, handlers, resolveFlow)).toEqual({ turn: ended, target: null });
  });

  it('jumps with the variables, keeps the effects but the jump, and names the version it went to', async () => {
    const { turn, target, problem } = await followJumps(start(JUMPER), handlers, resolveTo(ORDER));
    expect(target).toEqual({ versionId: 'v2', graph: ORDER });
    expect(problem).toBeUndefined();
    expect(turn.status).toBe('active');
    expect(turn.state.vars).toEqual({ from: 'jumper' });
    expect(turn.effects.map((x) => x.kind)).toEqual(['send', 'send', 'send']);
  });

  it('abandons a jump to a flow that is not there', async () => {
    const out = await followJumps(start(JUMPER), handlers, resolveTo(null));
    expect(out).toMatchObject({ problem: 'jump_target', target: null });
    expect(out.turn.status).toBe('abandoned');
  });

  it('stops two flows that jump to each other after MAX_JUMPS, without looking the next one up', async () => {
    // A guard so that a loop that never counts fails here instead of spinning forever.
    const resolveFlow = vi.fn((id: string) =>
      resolveFlow.mock.calls.length > 10
        ? Promise.reject(new Error('spins'))
        : resolveTo(JUMPER)(id),
    );
    const out = await followJumps(start(JUMPER), handlers, resolveFlow);
    expect(resolveFlow).toHaveBeenCalledTimes(MAX_JUMPS);
    expect(out).toMatchObject({ problem: 'jump_limit', target: { versionId: 'v2' } });
    expect(out.turn.status).toBe('abandoned');
    expect(out.turn.steps).toHaveLength(4 * (MAX_JUMPS + 1));
  });

  it('keeps the problem of the flow it jumped into', async () => {
    const spin: RuntimeGraph = {
      nodes: [n('start', 'trigger'), n('a', 'set_variable', { variable: 'x', value: 1 })],
      edges: [e('start', 'a'), e('a', 'a')],
    };
    const out = await followJumps(start(JUMPER), handlers, resolveTo(spin));
    expect(out.problem).toBe('step_limit');
    expect(out.turn.steps).toHaveLength(4 + MAX_STEPS);
  });
});

describe('replyText and handoffOf', () => {
  it('numbers the choices under the text', () => {
    expect(replyText({ kind: 'send', text: 'Loại?', choices: ['Hộp', 'Thùng'] })).toBe(
      'Loại?\n1. Hộp\n2. Thùng',
    );
    expect(replyText({ kind: 'send', text: 'Chào' })).toBe('Chào');
  });

  it('takes the reason of the handoff node, else the problem, else bot_abandoned', () => {
    const turn = start2([{ kind: 'handoff', reason: 'asked', priority: 'urgent' }]);
    expect(handoffOf(turn, 'bad_config')).toEqual({ reason: 'asked', priority: 'urgent' });
    expect(handoffOf(start2([{ kind: 'handoff', reason: 7 }]), 'bad_config')).toEqual({
      reason: 'bad_config',
    });
    expect(handoffOf(start2([]))).toEqual({ reason: 'bot_abandoned' });
  });
});

function start2(effects: { kind: string; [k: string]: unknown }[]) {
  return {
    status: 'handed_off' as const,
    state: { nodeKey: null, awaiting: null, vars: {} },
    effects,
    steps: [],
  };
}
