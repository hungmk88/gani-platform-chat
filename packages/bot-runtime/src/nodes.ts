// The core node types of the scripted bot (D1b2, Brief P13): trigger, message, question, condition, set_variable, end. Each is a
// pure handler for BotRuntime.step; the config of a node is the set A approved for D1a3 (bot-flows.schemas.ts). The handlers keep no
// state of their own and read no clock, so a turn the worker runs again after a crash (the session was not advanced) gives the same
// result. Which flow starts (keyword, intent, after hours) is chosen by the caller before the trigger runs (D1b3).
//
// Edges: a condition takes the edge labelled "true" or "false", else the unlabelled one; a choice question takes the edge labelled
// with the chosen choice, else the unlabelled one. A question asked MAX_ATTEMPTS times without a valid answer hands over.

import { toE164 } from '@gani/domain';

import { evaluateCondition } from './condition.js';
import {
  NodeConfigError,
  type Effect,
  type Handlers,
  type NodeResult,
  type RuntimeNode,
  type VarValue,
} from './runtime.js';
import { renderTemplate, type Scope, type ScopeGroup } from './scope.js';

export const MAX_ATTEMPTS = 3;
const MAX_TEXT_ANSWER = 500;
const VARIABLE = /^[a-z][a-z0-9_]{0,63}$/;
const KINDS = new Set(['text', 'phone', 'number', 'choice']);

const NEXT: NodeResult = { outcome: { kind: 'next' } };

function configString(node: RuntimeNode, field: string, pattern?: RegExp): string {
  const value = node.config[field];
  if (typeof value !== 'string' || value === '' || (pattern && !pattern.test(value)))
    throw new NodeConfigError(`${node.type}.${field}`);
  return value;
}

function choicesOf(node: RuntimeNode): readonly string[] {
  const choices = node.config.choices;
  if (
    !Array.isArray(choices) ||
    choices.length === 0 ||
    !choices.every((c) => typeof c === 'string')
  )
    throw new NodeConfigError('question.choices');
  return choices;
}

/** Lower case, no diacritics, single spaces: "Có ạ" and "co a" are the same answer. */
export const foldText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** A number as people type it here: "12", "-3", "1,5" or "1.5", "1.000.000" (dots between thousands); null otherwise. */
function parseNumber(text: string): number | null {
  const t = text.replace(/\s+/g, '');
  if (/^-?\d{1,3}(?:\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return null;
}

function questionKind(node: RuntimeNode): string {
  const kind = configString(node, 'kind');
  if (!KINDS.has(kind)) throw new NodeConfigError('question.kind');
  return kind;
}

/** The value of a valid answer to the question `node`, or null when the answer does not fit its kind. */
export function parseAnswer(node: RuntimeNode, text: string): VarValue | null {
  const kind = questionKind(node);
  const answer = text.trim();
  if (kind === 'phone') return toE164(answer);
  if (kind === 'number') return parseNumber(answer);
  if (kind === 'choice') {
    const choices = choicesOf(node);
    const index = /^\d{1,2}$/.test(answer) ? Number(answer) - 1 : -1;
    return choices[index] ?? choices.find((c) => foldText(c) === foldText(answer)) ?? null;
  }
  return answer === '' ? null : answer.slice(0, MAX_TEXT_ANSWER);
}

/**
 * The core handlers for one turn. `context` is what the caller knows of the turn (`customer`, `conversation`, `workspace`…), read by
 * templates and conditions next to the session's variables (`vars`).
 */
export function coreHandlers(context: Readonly<Record<string, ScopeGroup>>): Handlers {
  const scope = (vars: Readonly<Record<string, VarValue>>): Scope => ({ ...context, vars });
  const send = (
    node: RuntimeNode,
    vars: Readonly<Record<string, VarValue>>,
    extra = {},
  ): Effect => ({
    kind: 'send',
    node: node.key,
    text: renderTemplate(configString(node, 'text'), scope(vars)),
    ...extra,
  });
  const ask = (
    node: RuntimeNode,
    vars: Readonly<Record<string, VarValue>>,
    attempts: number,
  ): NodeResult => {
    // The whole config is checked before the customer is asked, not when the answer comes.
    configString(node, 'variable', VARIABLE);
    const choices = questionKind(node) === 'choice' ? { choices: choicesOf(node) } : {};
    return {
      outcome: { kind: 'wait', awaiting: { attempts } },
      effects: [send(node, vars, { ...choices, ...(attempts > 0 ? { retry: true } : {}) })],
    };
  };

  return {
    trigger: { enter: () => NEXT },
    message: { enter: (node, vars) => ({ ...NEXT, effects: [send(node, vars)] }) },
    question: {
      enter: (node, vars) => ask(node, vars, 0),
      resume: (node, awaiting, text, vars) => {
        const variable = configString(node, 'variable', VARIABLE);
        const value = parseAnswer(node, text);
        if (value === null) {
          const attempts = (typeof awaiting.attempts === 'number' ? awaiting.attempts : 0) + 1;
          if (attempts < MAX_ATTEMPTS) return ask(node, vars, attempts);
          return {
            outcome: { kind: 'handoff' },
            effects: [{ kind: 'handoff', reason: 'question_unanswered' }],
          };
        }
        const label = node.config.kind === 'choice' ? { label: String(value) } : {};
        return { outcome: { kind: 'next', ...label }, vars: { [variable]: value }, variable };
      },
    },
    condition: {
      enter: (node, vars) => ({
        outcome: {
          kind: 'next',
          label: evaluateCondition(node.config.expression, scope(vars)) ? 'true' : 'false',
        },
      }),
    },
    set_variable: {
      enter: (node) => {
        const variable = configString(node, 'variable', VARIABLE);
        const value = node.config.value;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
          throw new NodeConfigError('set_variable.value');
        return { ...NEXT, vars: { [variable]: value }, variable };
      },
    },
    end: { enter: () => ({ outcome: { kind: 'end' } }) },
  };
}
