// What a node can read (D1b2, Brief P13 and P15): the session's variables under `vars`, and what the caller knows of the turn
// (`customer`, `conversation`, `workspace`…), each a group of named values. A template names a value as `{{customer.name}}`, a
// condition as `{ "field": "vars.size", … }`. Two levels only: a group, then a name.

import type { VarValue } from './runtime.js';

export type ScopeGroup = Readonly<Record<string, VarValue | null>>;
export type Scope = Readonly<Record<string, ScopeGroup>>;

/** The value at `path` ("group.name"), or undefined when the scope does not hold it (never a property of Object's prototype). */
export function lookup(scope: Scope, path: string): VarValue | null | undefined {
  const dot = path.indexOf('.');
  if (dot <= 0) return undefined;
  const [group, name] = [path.slice(0, dot), path.slice(dot + 1)];
  if (!Object.hasOwn(scope, group) || !Object.hasOwn(scope[group]!, name)) return undefined;
  return scope[group]![name];
}

const PLACEHOLDER = /\{\{\s*([a-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** `text` with each `{{group.name}}` replaced by its value; a value the scope does not hold, or null, becomes empty text. */
export function renderTemplate(text: string, scope: Scope): string {
  return text.replace(PLACEHOLDER, (_, path: string) => {
    const value = lookup(scope, path);
    return value === undefined || value === null ? '' : String(value);
  });
}
