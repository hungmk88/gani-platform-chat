import { describe, expect, it } from 'vitest';

import { MAX_ATTEMPTS, coreHandlers, parseAnswer } from './nodes.js';
import { step, type RuntimeGraph, type RuntimeNode, type SessionState } from './runtime.js';

// The core node types run by BotRuntime.step (D1b2): an order flow that greets, asks for a phone, a quantity and a choice, branches
// on a condition and ends.
const handlers = coreHandlers({ customer: { name: 'Lan' }, workspace: { isBusinessHours: true } });
const n = (key: string, type: string, config: Record<string, unknown> = {}): RuntimeNode => ({
  key,
  type,
  config,
});
const e = (from: string, to: string, label: string | null = null) => ({ from, to, label });
const ask = (key: string, kind: string, variable: string, extra = {}) =>
  n(key, 'question', { text: `Hỏi ${key}?`, kind, variable, ...extra });
const GRAPH: RuntimeGraph = {
  nodes: [
    n('start', 'trigger', { on: 'first_message' }),
    n('hi', 'message', { text: 'Chào {{customer.name}}!' }),
    ask('phone', 'phone', 'phone'),
    ask('qty', 'number', 'qty'),
    ask('pack', 'choice', 'pack', { choices: ['Hộp', 'Thùng'] }),
    n('big', 'condition', { expression: { field: 'vars.qty', op: 'gte', value: 100 } }),
    n('mark', 'set_variable', { variable: 'segment', value: 'wholesale' }),
    n('thanks', 'message', { text: '{{vars.qty}} {{vars.pack}}, cảm ơn.' }),
    n('done', 'end'),
  ],
  edges: [
    e('start', 'hi'),
    e('hi', 'phone'),
    e('phone', 'qty'),
    e('qty', 'pack'),
    e('pack', 'big', 'Thùng'),
    e('pack', 'thanks'),
    e('big', 'mark', 'true'),
    e('big', 'thanks', 'false'),
    e('mark', 'thanks'),
    e('thanks', 'done'),
  ],
};
const FRESH: SessionState = { nodeKey: null, awaiting: null, vars: {} };
const turns = (...texts: string[]) => {
  let turn = step(GRAPH, FRESH, { kind: 'start' }, handlers);
  for (const text of texts) turn = step(GRAPH, turn.state, { kind: 'message', text }, handlers);
  return turn;
};

describe('core nodes', () => {
  it('greets with the template filled, then asks and waits', () => {
    expect(turns()).toMatchObject({
      status: 'active',
      state: { nodeKey: 'phone', awaiting: { attempts: 0 } },
      effects: [
        { kind: 'send', node: 'hi', text: 'Chào Lan!' },
        { kind: 'send', node: 'phone', text: 'Hỏi phone?' },
      ],
    });
    expect(turns('0912 345 678').effects).toEqual([
      { kind: 'send', node: 'qty', text: 'Hỏi qty?' },
    ]);
  });

  it('stores the answers, branches by choice and condition, sets a variable and ends', () => {
    const turn = turns('0912 345 678', '1.200', 'thung');
    expect(turn.status).toBe('completed');
    expect(turn.state.vars).toEqual({
      phone: '+84912345678',
      qty: 1200,
      pack: 'Thùng',
      segment: 'wholesale',
    });
    expect(turn.effects).toEqual([{ kind: 'send', node: 'thanks', text: '1200 Thùng, cảm ơn.' }]);
    // The steps name the edge and the variable, never the value (bot_session_steps).
    expect(turn.steps).toEqual([
      { nodeKey: 'pack', nodeType: 'question', edgeLabel: 'Thùng', variable: 'pack' },
      { nodeKey: 'big', nodeType: 'condition', edgeLabel: 'true' },
      { nodeKey: 'mark', nodeType: 'set_variable', variable: 'segment' },
      { nodeKey: 'thanks', nodeType: 'message' },
      { nodeKey: 'done', nodeType: 'end' },
    ]);
    expect(turns('0912345678', '12', '2').state.vars).toMatchObject({ qty: 12, pack: 'Thùng' });
    expect(turns('0912345678', '12', '2').steps.map((s) => s.nodeKey)).toEqual([
      'pack',
      'big',
      'thanks',
      'done',
    ]);
    expect(turns('0912345678', '12', 'Hộp').steps.map((s) => s.nodeKey)).toEqual([
      'pack',
      'thanks',
      'done',
    ]);
  });

  it('asks again on an answer that does not fit, then hands over after MAX_ATTEMPTS', () => {
    const again = turns('không có');
    expect(again).toMatchObject({
      status: 'active',
      state: { nodeKey: 'phone', awaiting: { attempts: 1 } },
      effects: [{ kind: 'send', node: 'phone', text: 'Hỏi phone?', retry: true }],
    });
    const wrong = Array.from({ length: MAX_ATTEMPTS }, () => 'x');
    expect(turns(...wrong)).toMatchObject({
      status: 'handed_off',
      effects: [{ kind: 'handoff', reason: 'question_unanswered' }],
    });
    expect(turns('0912345678', '12', 'Bao').effects[0]).toMatchObject({
      choices: ['Hộp', 'Thùng'],
      retry: true,
    });
  });

  it('gives the same turn when the worker runs it again after a crash', () => {
    const waiting = turns('0912345678').state;
    const input = { kind: 'message', text: '5' } as const;
    expect(step(GRAPH, waiting, input, handlers)).toEqual(step(GRAPH, waiting, input, handlers));
  });

  it('parses each kind of answer the way people type it', () => {
    const q = (kind: string, extra = {}) => ask('q', kind, 'v', extra);
    expect(parseAnswer(q('text'), '  Giao sáng  ')).toBe('Giao sáng');
    expect(parseAnswer(q('text'), '   ')).toBeNull();
    expect(parseAnswer(q('text'), 'a'.repeat(900))).toHaveLength(500);
    expect(parseAnswer(q('phone'), '+84 912.345.678')).toBe('+84912345678');
    expect(parseAnswer(q('phone'), '12345')).toBeNull();
    for (const [text, value] of [
      ['12', 12],
      ['-3', -3],
      ['1,5', 1.5],
      ['2.5', 2.5],
      ['1.000.000', 1_000_000],
      ['1 000', 1000],
    ] as const)
      expect(parseAnswer(q('number'), text), text).toBe(value);
    for (const text of ['abc', '1.2.3', '1,000,000', ''])
      expect(parseAnswer(q('number'), text), text).toBeNull();
    const choice = q('choice', { choices: ['Có ạ', 'Không'] });
    expect(parseAnswer(choice, 'co  A')).toBe('Có ạ');
    expect(parseAnswer(choice, '2')).toBe('Không');
    expect(parseAnswer(choice, '3')).toBeNull();
    expect(parseAnswer(choice, 'Đúng')).toBeNull();
    expect(parseAnswer(q('choice', { choices: ['Đổi hàng'] }), 'doi hang')).toBe('Đổi hàng');
  });

  it('abandons a node whose config cannot run, before the customer is asked', () => {
    const broken = (node: RuntimeNode) =>
      step(
        { nodes: [n('start', 'trigger'), node], edges: [e('start', node.key)] },
        FRESH,
        { kind: 'start' },
        handlers,
      );
    for (const node of [
      n('m', 'message', {}),
      n('m', 'message', { text: '' }),
      ask('q', 'date', 'v'),
      ask('q', 'text', 'Bad-Name'),
      ask('q', 'choice', 'v'),
      ask('q', 'choice', 'v', { choices: [] }),
      ask('q', 'choice', 'v', { choices: [1] }),
      n('c', 'condition', { expression: 'x' }),
      n('s', 'set_variable', { variable: 'v', value: null }),
      n('s', 'set_variable', { value: 1 }),
    ])
      expect(broken(node), JSON.stringify(node)).toMatchObject({
        status: 'abandoned',
        error: 'bad_config',
        effects: [],
      });
    // A broken config found on resume abandons too; other errors are bugs and go up.
    const odd: SessionState = { nodeKey: 'q', awaiting: { attempts: 'x' }, vars: {} };
    const graph = { nodes: [n('start', 'trigger'), ask('q', 'mystery', 'v')], edges: [] };
    expect(step(graph, odd, { kind: 'message', text: 'a' }, handlers).error).toBe('bad_config');
    const boom = {
      trigger: {
        enter: () => {
          throw new Error('bug');
        },
      },
    };
    expect(() => step(GRAPH, FRESH, { kind: 'start' }, boom)).toThrow('bug');
  });

  it('hands over with the reason and priority, and jumps to another flow by ending with a jump', () => {
    const flowId = '0190a000-0000-7000-8000-000000000001';
    const run = (node: RuntimeNode) =>
      step(
        { nodes: [n('start', 'trigger'), node], edges: [e('start', node.key)] },
        FRESH,
        { kind: 'start' },
        handlers,
      );
    expect(run(n('h', 'handoff', { reason: 'Khiếu nại', priority: 'urgent' }))).toMatchObject({
      status: 'handed_off',
      effects: [{ kind: 'handoff', reason: 'Khiếu nại', priority: 'urgent' }],
    });
    expect(run(n('j', 'jump_to_flow', { flowId }))).toMatchObject({
      status: 'completed',
      effects: [{ kind: 'jump', flowId }],
    });
    for (const node of [
      n('h', 'handoff', { reason: 'x', priority: 'asap' }),
      n('h', 'handoff', { priority: 'high' }),
      n('j', 'jump_to_flow', { flowId: 'not-a-uuid' }),
    ])
      expect(run(node).error, JSON.stringify(node)).toBe('bad_config');
  });

  it('counts an attempt from zero when the awaiting state lost it', () => {
    const lost: SessionState = { nodeKey: 'phone', awaiting: {}, vars: {} };
    expect(step(GRAPH, lost, { kind: 'message', text: 'x' }, handlers).state.awaiting).toEqual({
      attempts: 1,
    });
  });
});
