import { describe, expect, it } from 'vitest';

import { MAX_STEPS, step, type Handlers, type RuntimeGraph, type SessionState } from './runtime.js';

// Test handlers only (the real ones are D1b2): a trigger and a say go on, ask waits then takes the edge named by the answer, a
// remember stores a variable, done ends, human hands over.
const handlers: Handlers = {
  trigger: { enter: () => ({ outcome: { kind: 'next' } }) },
  say: {
    enter: (node) => ({ outcome: { kind: 'next' }, effects: [{ kind: 'send', node: node.key }] }),
  },
  ask: {
    enter: (node) => ({ outcome: { kind: 'wait', awaiting: { node: node.key } } }),
    resume: (_node, _awaiting, text) => ({
      outcome: { kind: 'next', label: text },
      vars: { answer: text },
      variable: 'answer',
    }),
  },
  done: { enter: () => ({ outcome: { kind: 'end' } }) },
  human: { enter: () => ({ outcome: { kind: 'handoff' }, effects: [{ kind: 'handoff' }] }) },
};
const n = (key: string, type = key) => ({ key, type, config: {} });
const e = (from: string, to: string, label: string | null = null) => ({ from, to, label });
const GRAPH: RuntimeGraph = {
  nodes: [
    n('start', 'trigger'),
    n('hi', 'say'),
    n('q', 'ask'),
    n('yes', 'say'),
    n('end', 'done'),
    n('help', 'human'),
  ],
  edges: [e('start', 'hi'), e('hi', 'q'), e('q', 'yes', 'Có'), e('q', 'help'), e('yes', 'end')],
};
const FRESH: SessionState = { nodeKey: null, awaiting: null, vars: {} };

describe('step', () => {
  it('starts at the trigger, walks to the first node that waits, and stops there', () => {
    const turn = step(GRAPH, FRESH, { kind: 'start' }, handlers);
    expect(turn).toEqual({
      status: 'active',
      state: { nodeKey: 'q', awaiting: { node: 'q' }, vars: {} },
      effects: [{ kind: 'send', node: 'hi' }],
      steps: [
        { nodeKey: 'start', nodeType: 'trigger' },
        { nodeKey: 'hi', nodeType: 'say' },
        { nodeKey: 'q', nodeType: 'ask' },
      ],
    });
  });

  it('resumes the waiting node with the answer, takes the edge it names, and ends', () => {
    const waiting = step(GRAPH, FRESH, { kind: 'start' }, handlers).state;
    const turn = step(GRAPH, waiting, { kind: 'message', text: 'Có' }, handlers);
    expect(turn.status).toBe('completed');
    expect(turn.state).toEqual({ nodeKey: 'end', awaiting: null, vars: { answer: 'Có' } });
    expect(turn.steps).toEqual([
      { nodeKey: 'q', nodeType: 'ask', edgeLabel: 'Có', variable: 'answer' },
      { nodeKey: 'yes', nodeType: 'say' },
      { nodeKey: 'end', nodeType: 'done' },
    ]);
  });

  it('falls back to the unlabelled edge, and hands over where the flow says so', () => {
    const waiting = step(GRAPH, FRESH, { kind: 'start' }, handlers).state;
    const turn = step(GRAPH, waiting, { kind: 'message', text: 'Không biết' }, handlers);
    expect(turn.status).toBe('handed_off');
    expect(turn.effects).toEqual([{ kind: 'handoff' }]);
    expect(turn.steps.map((s) => s.nodeKey)).toEqual(['q', 'help']);
  });

  it('ends when no edge leaves a node, and starts again at the trigger when nothing waits', () => {
    const short: RuntimeGraph = {
      nodes: [n('start', 'trigger'), n('hi', 'say')],
      edges: [e('start', 'hi')],
    };
    expect(step(short, FRESH, { kind: 'start' }, handlers)).toMatchObject({
      status: 'completed',
      state: { nodeKey: 'hi' },
    });
    const notWaiting = { nodeKey: 'hi', awaiting: null, vars: {} };
    expect(
      step(short, notWaiting, { kind: 'message', text: 'x' }, handlers).steps[0]?.nodeKey,
    ).toBe('start');
  });

  it('stops a loop after MAX_STEPS nodes instead of spinning', () => {
    const loop: RuntimeGraph = {
      nodes: [n('start', 'trigger'), n('a', 'say')],
      edges: [e('start', 'a'), e('a', 'a')],
    };
    const turn = step(loop, FRESH, { kind: 'start' }, handlers);
    expect(turn).toMatchObject({ status: 'abandoned', error: 'step_limit' });
    expect(turn.steps).toHaveLength(MAX_STEPS);
  });

  it('abandons a broken flow with the reason, never a crash', () => {
    expect(
      step({ nodes: [n('hi', 'say')], edges: [] }, FRESH, { kind: 'start' }, handlers).error,
    ).toBe('no_trigger');
    expect(
      step(
        { nodes: [n('s', 'mystery')], edges: [] },
        { ...FRESH, nodeKey: null },
        { kind: 'start' },
        handlers,
      ).error,
    ).toBe('no_trigger');
    const missing: RuntimeGraph = { nodes: [n('start', 'trigger')], edges: [e('start', 'gone')] };
    expect(step(missing, FRESH, { kind: 'start' }, handlers)).toMatchObject({
      status: 'abandoned',
      error: 'unknown_node',
    });
    const odd: RuntimeGraph = {
      nodes: [n('start', 'trigger'), n('x', 'mystery')],
      edges: [e('start', 'x')],
    };
    expect(step(odd, FRESH, { kind: 'start' }, handlers).error).toBe('no_handler');
    expect(step(odd, FRESH, { kind: 'start' }, {}).error).toBe('no_handler');
    const waitingOn = (nodeKey: string) => ({ nodeKey, awaiting: {}, vars: {} });
    expect(step(GRAPH, waitingOn('gone'), { kind: 'message', text: 'x' }, handlers).error).toBe(
      'unknown_node',
    );
    expect(step(GRAPH, waitingOn('hi'), { kind: 'message', text: 'x' }, handlers).error).toBe(
      'no_handler',
    );
  });
});
