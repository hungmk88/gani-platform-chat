import { describe, expect, it } from 'vitest';

import { evaluateCondition } from './condition.js';
import { NodeConfigError } from './runtime.js';
import { lookup, renderTemplate, type Scope } from './scope.js';

// The condition language of Brief P15 and the templates of the message node, over the scope of a turn.
const scope: Scope = {
  vars: { size: 12, city: 'Hà Nội', vip: true, empty: '' },
  customer: { name: 'Lan', phone: null },
  workspace: { isBusinessHours: false },
};
const c = (field: string, op: string, value?: unknown) =>
  value === undefined ? { field, op } : { field, op, value };
const holds = (e: unknown) => evaluateCondition(e, scope);

describe('evaluateCondition', () => {
  it('compares with each operator', () => {
    expect(holds(c('vars.size', 'eq', 12))).toBe(true);
    expect(holds(c('vars.size', 'eq', '12'))).toBe(false);
    expect(holds(c('vars.city', 'neq', 'Huế'))).toBe(true);
    expect(holds(c('vars.size', 'gt', 12))).toBe(false);
    expect(holds(c('vars.size', 'gte', 12))).toBe(true);
    expect(holds(c('vars.size', 'gt', 11))).toBe(true);
    expect(holds(c('vars.city', 'gt', 1))).toBe(false);
    expect(holds(c('vars.city', 'in', ['Huế', 'Hà Nội']))).toBe(true);
    expect(holds(c('vars.gone', 'in', ['x']))).toBe(false);
    expect(holds(c('customer.phone', 'in', [null]))).toBe(false);
    expect(holds(c('vars.city', 'contains', 'HÀ'))).toBe(true);
    expect(holds(c('vars.size', 'contains', '1'))).toBe(false);
    expect(holds(c('customer.name', 'exists'))).toBe(true);
    expect(holds(c('customer.phone', 'exists'))).toBe(false);
    expect(holds(c('vars.empty', 'exists'))).toBe(false);
    expect(holds(c('vars.gone', 'exists', false))).toBe(true);
    expect(holds(c('workspace.isBusinessHours', 'eq', false))).toBe(true);
  });

  it('combines with all, any and not, the example of P15 included', () => {
    const p15 = { all: [c('vars.size', 'gte', 10), c('workspace.isBusinessHours', 'eq', false)] };
    expect(holds(p15)).toBe(true);
    expect(holds({ all: [c('vars.vip', 'eq', true), c('vars.size', 'gt', 99)] })).toBe(false);
    expect(holds({ any: [c('vars.size', 'gt', 99), c('vars.vip', 'eq', true)] })).toBe(true);
    expect(holds({ any: [c('vars.size', 'gt', 99)] })).toBe(false);
    expect(holds({ not: c('vars.vip', 'eq', true) })).toBe(false);
  });

  it('refuses an expression outside the language, even in a branch that does not decide', () => {
    // Eleven `not` deep: past MAX_DEPTH.
    let deep: unknown = c('vars.vip', 'exists');
    for (let i = 0; i < 11; i += 1) deep = { not: deep };
    const bad: unknown[] = [
      null,
      [],
      'vars.size > 1',
      {},
      { all: [] },
      { any: 'x' },
      { all: [c('vars.vip', 'eq', true)], any: [c('vars.vip', 'eq', true)] },
      c('vars.size', 'lt', 1),
      { field: 1, op: 'eq', value: 1 },
      { field: 'vars.size', op: 'eq' },
      { field: 'vars.size', op: 'eq', value: 1, extra: true },
      c('vars.size', 'gt', '1'),
      c('vars.size', 'in', 'x'),
      c('vars.city', 'contains', 1),
      { any: [c('vars.vip', 'eq', true), c('vars.size', 'lt', 1)] },
      deep,
    ];
    for (const e of bad) expect(() => holds(e), JSON.stringify(e)).toThrow(NodeConfigError);
  });
});

describe('scope', () => {
  it('looks a value up by group and name, never on the prototype', () => {
    expect(lookup(scope, 'vars.size')).toBe(12);
    expect(lookup(scope, 'customer.phone')).toBeNull();
    for (const path of ['size', '.size', 'vars.constructor', 'toString.x', 'nope.size'])
      expect(lookup(scope, path), path).toBeUndefined();
  });

  it('renders the placeholders of a template, a missing or null value as empty text', () => {
    expect(
      renderTemplate('Chào {{customer.name}}, {{ vars.size }} hộp, ở {{vars.city}}.', scope),
    ).toBe('Chào Lan, 12 hộp, ở Hà Nội.');
    expect(renderTemplate('[{{customer.phone}}][{{vars.gone}}][{{vars.vip}}]', scope)).toBe(
      '[][][true]',
    );
    expect(renderTemplate('{{price_1}} {{ Bad.name }}', scope)).toBe('{{price_1}} {{ Bad.name }}');
  });
});
