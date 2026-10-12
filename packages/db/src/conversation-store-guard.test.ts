import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Second lock of CLAUDE.md rule 4 (the first is ESLint): reads the source of every package and app, so a way around ESLint shows up here.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const STORE = 'packages/db/src/conversation-store.ts';
const WRITES = [/\bUPDATE\s+(?:public\.)?conversations\b/i, /\.update\(\s*conversations\b/];
// What the two patterns above miss (review D-03): `const c = conversations; tx.update(c)`. Only a file that imports the table can do it.
// `message-store.ts` does, on purpose, for the marks of the conversation; the DB trigger is the lock that holds for the FSM columns.
const MARKS = 'packages/db/src/message-store.ts';
const FSM_KEYS = /\b(?:state|version|assignedUserId|afterHoursHold|closedAt|outcome)\s*:/;

/** The `.update(x)` calls whose `x` is the `conversations` table or a name bound to it (`const c = conversations`). */
export function aliasUpdates(source: string): string[] {
  if (!/\bimport\b[^;]*\bconversations\b[^;]*\bfrom\b/.test(source)) return [];
  const names = new Set(['conversations']);
  for (const m of source.matchAll(
    /\b(?:const|let|var)\s+(\w+)\s*(?::[^=;]+)?=\s*conversations\s*;/g,
  ))
    if (m[1]) names.add(m[1]);
  return [...source.matchAll(/\.update\(\s*(\w+)\s*\)/g)]
    .filter((m) => m[1] !== undefined && names.has(m[1]))
    .map((m) => m[0]);
}

/** The text of the first `.set(...)` that follows `.update(...)`, up to `.where(`: what the statement writes. */
export function setBlock(source: string): string {
  const from = source.search(/\.update\(/);
  if (from === -1) return '';
  const set = source.indexOf('.set(', from);
  const end = source.indexOf('.where(', set);
  return set === -1 || end === -1 ? '' : source.slice(set, end);
}

function walk(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    // A symlink is neither a directory nor a file here, so it is never followed (pnpm links packages into each other's node_modules).
    if (entry.isDirectory()) walk(path, found);
    else if (
      entry.isFile() &&
      /\.(ts|tsx|mts|mjs)$/.test(entry.name) &&
      !/\.(test|spec)\.ts$/.test(entry.name)
    )
      found.push(path);
  }
}

/** The source files (`<app or package>/src/**`) under `base`: never node_modules, build output, coverage folders or symlinks. */
function sources(base: string): string[] {
  const found: string[] = [];
  for (const top of ['apps', 'packages']) {
    for (const pkg of readdirSync(join(base, top), { withFileTypes: true })) {
      const src = join(base, top, pkg.name, 'src');
      if (pkg.isDirectory() && existsSync(src)) walk(src, found);
    }
  }
  return found.map((path) => relative(base, path).split(sep).join('/')).sort();
}

describe('only the conversation store writes conversations', () => {
  const files = sources(root);
  const writers = files.filter((file) =>
    WRITES.some((pattern) => pattern.test(readFileSync(join(root, file), 'utf8'))),
  );

  it('finds the store itself, so the scan is not blind, and never looks into node_modules', () => {
    expect(writers).toContain(STORE);
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
  });

  it('finds nothing else in the source of any package or app', () => {
    expect(writers.filter((file) => file !== STORE)).toEqual([]);
  });
});

describe('writes through an alias of the table (review D-03)', () => {
  const files = sources(root);
  const sourceOf = (file: string) => readFileSync(join(root, file), 'utf8');

  it('are only in the store and in the file that moves the marks', () => {
    const writers = files.filter((file) => aliasUpdates(sourceOf(file)).length > 0);
    expect(writers).toEqual([STORE, MARKS].sort());
  });

  it('write no column of the state machine in the file that moves the marks', () => {
    const block = setBlock(sourceOf(MARKS));
    expect(block).toContain('lastMessageAt');
    expect(FSM_KEYS.test(block)).toBe(false);
  });

  it('sees an alias, a typed alias and the table itself, and nothing else', () => {
    const imported = "import { conversations } from './schema/conversations.js';\n";
    expect(
      aliasUpdates(`${imported}const c = conversations;\ntx.update(c).set({ a: 1 });`),
    ).toEqual(['.update(c)']);
    expect(aliasUpdates(`${imported}const t: T = conversations;\ntx.update(t);`)).toEqual([
      '.update(t)',
    ]);
    expect(aliasUpdates(`${imported}tx.update(conversations);`)).toEqual([
      '.update(conversations)',
    ]);
    expect(aliasUpdates(`${imported}const c = messages;\ntx.update(c);`)).toEqual([]);
    expect(aliasUpdates('const c = conversations;\ntx.update(c);')).toEqual([]);
  });

  it('sees a column of the state machine in a set block, and a mark only is clean', () => {
    const writes = (set: string) => FSM_KEYS.test(setBlock(`tx.update(c)${set}.where(x)`));
    expect(writes('.set({ lastMessageAt: now, updatedAt: now })')).toBe(false);
    expect(writes('.set({ lastMessageAt: now, state: next })')).toBe(true);
    expect(writes('.set({ ...fsm, version: sql`v + 1` })')).toBe(true);
    expect(setBlock('no update here')).toBe('');
  });
});

describe('the scan of the source tree', () => {
  it('skips node_modules, coverage folders and symlinks (even a dangling one), and keeps real sources', () => {
    const base = mkdtempSync(join(tmpdir(), 'guard-'));
    try {
      const put = (path: string, text = 'export const x = 1;') => {
        mkdirSync(join(base, path, '..'), { recursive: true });
        writeFileSync(join(base, path), text);
      };
      mkdirSync(join(base, 'apps'));
      put('packages/a/src/keep.ts');
      put('packages/a/src/deep/keep.mts');
      put('packages/a/src/skip.test.ts');
      put('packages/a/node_modules/b/src/dep.ts', 'UPDATE conversations');
      put('packages/a/src/node_modules/c/dep.ts', 'UPDATE conversations');
      put('packages/a/coverage/.tmp/gone.ts');
      put('packages/b/dist/out.mjs');
      try {
        symlinkSync(join(base, 'does-not-exist'), join(base, 'packages/a/src/dangling'));
        symlinkSync(
          join(base, 'packages/a/node_modules'),
          join(base, 'packages/a/src/linked'),
          'junction',
        );
      } catch {
        // Creating a symlink may need a privilege (Windows); the rest of the test still holds.
      }
      expect(sources(base)).toEqual(['packages/a/src/deep/keep.mts', 'packages/a/src/keep.ts']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
