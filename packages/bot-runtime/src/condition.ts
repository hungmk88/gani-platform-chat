// The condition language of Brief P15, shared by the bot's condition node (P13): `all` / `any` / `not` over comparisons
// `{ field, op, value }` with the operators eq, neq, gt, gte, in, contains, exists. An expression that does not follow the language
// throws NodeConfigError (the turn is abandoned and the conversation goes to a person), never a silent false.

import { NodeConfigError, type VarValue } from './runtime.js';
import { lookup, type Scope } from './scope.js';

const MAX_DEPTH = 10;
const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'in', 'contains', 'exists']);

const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const fold = (s: string) => s.normalize('NFC').toLowerCase();

function compare(op: string, actual: VarValue | null | undefined, value: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'gt':
    case 'gte':
      if (typeof value !== 'number') throw new NodeConfigError('bad_condition');
      if (typeof actual !== 'number') return false;
      return op === 'gt' ? actual > value : actual >= value;
    case 'in':
      if (!Array.isArray(value)) throw new NodeConfigError('bad_condition');
      return actual !== undefined && actual !== null && value.includes(actual);
    case 'contains':
      if (typeof value !== 'string') throw new NodeConfigError('bad_condition');
      return typeof actual === 'string' && fold(actual).includes(fold(value));
    default: {
      // exists: the value is there and not empty; `value: false` asks the opposite.
      const there = actual !== undefined && actual !== null && actual !== '';
      return value === false ? !there : there;
    }
  }
}

/** Whether `expression` holds in `scope`. */
export function evaluateCondition(expression: unknown, scope: Scope, depth = 0): boolean {
  if (!isObject(expression) || depth > MAX_DEPTH) throw new NodeConfigError('bad_condition');
  const keys = Object.keys(expression);
  const list = (v: unknown) => {
    if (!Array.isArray(v) || v.length === 0) throw new NodeConfigError('bad_condition');
    // Every branch is evaluated, no short cut: a broken branch is found even when another decides.
    return v.map((e) => evaluateCondition(e, scope, depth + 1));
  };
  if (keys.length === 1 && keys[0] === 'all') return list(expression.all).every(Boolean);
  if (keys.length === 1 && keys[0] === 'any') return list(expression.any).some(Boolean);
  if (keys.length === 1 && keys[0] === 'not')
    return !evaluateCondition(expression.not, scope, depth + 1);
  const { field, op, value, ...rest } = expression;
  if (
    typeof field !== 'string' ||
    typeof op !== 'string' ||
    !OPS.has(op) ||
    Object.keys(rest).length
  )
    throw new NodeConfigError('bad_condition');
  if (op !== 'exists' && !('value' in expression)) throw new NodeConfigError('bad_condition');
  return compare(op, lookup(scope, field), value);
}
