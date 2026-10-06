import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// The crash point of K2 lives in test/support/crash-main.mjs only. The worker that runs in production must not be able to kill
// itself, so neither its source nor its build may mention the switch of the test entry. (Built here from two pieces so that this
// file is not itself a match.)
const SWITCH = ['CRASH', 'AT'].join('_');
const workerDir = resolve(import.meta.dirname, '..');

function filesOf(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(join(workerDir, dir), { recursive: true, encoding: 'utf8' })
    .filter(keep)
    .map((path) => join(workerDir, dir, path));
}

describe('the production worker has no crash switch', () => {
  it('has none in the source of src/ (tests aside)', () => {
    const files = filesOf('src', (p) => p.endsWith('.ts') && !p.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(5);
    expect(files.filter((f) => readFileSync(f, 'utf8').includes(SWITCH))).toEqual([]);
  });

  it('has none in the build of dist/ (run `pnpm --filter @gani/worker build` first)', () => {
    const files = filesOf('dist', (p) => p.endsWith('.js'));
    expect(files.length, 'dist/ is empty: build the worker first').toBeGreaterThan(5);
    expect(files.filter((f) => readFileSync(f, 'utf8').includes(SWITCH))).toEqual([]);
  });

  it('is in the test entry, so the scan is looking for the right word', () => {
    const entry = readFileSync(join(workerDir, 'test/support/crash-main.mjs'), 'utf8');
    expect(entry).toContain(SWITCH);
  });
});
