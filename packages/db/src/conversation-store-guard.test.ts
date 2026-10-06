import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Second lock of CLAUDE.md rule 4 (the first is ESLint): reads the source of every package and app, so a way around ESLint shows up here.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const STORE = 'packages/db/src/conversation-store.ts';
const WRITES = [/\bUPDATE\s+(?:public\.)?conversations\b/i, /\.update\(\s*conversations\b/];

function sources(): string[] {
  const found: string[] = [];
  for (const top of ['apps', 'packages']) {
    for (const entry of readdirSync(join(root, top), { recursive: true, encoding: 'utf8' })) {
      const path = entry.replaceAll('\\', '/');
      if (!/\/src\/.*\.(ts|tsx|mts|mjs)$/.test(`${top}/${path}`)) continue;
      if (/node_modules|\/dist\/|\.test\.ts$|\.spec\.ts$/.test(`${top}/${path}`)) continue;
      found.push(relative(root, join(root, top, path)).replaceAll('\\', '/'));
    }
  }
  return found;
}

describe('only the conversation store writes conversations', () => {
  const writers = sources().filter((file) => {
    const text = readFileSync(join(root, file), 'utf8');
    return WRITES.some((pattern) => pattern.test(text));
  });

  it('finds the store itself, so the scan is not blind', () => {
    expect(writers).toContain(STORE);
  });

  it('finds nothing else in the source of any package or app', () => {
    expect(writers.filter((file) => file !== STORE)).toEqual([]);
  });
});
