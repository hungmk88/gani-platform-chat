import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// test/support/crash-main.mjs must build the worker as src/main.ts does (apps/worker/CLAUDE.md, "Kiểm chứng"): the kill-test K2 runs
// it in place of main.ts, so a part wired in one and not the other is a part K2 never sees. Compared here: every port or job made
// (`create…(`, `start…(`, `realtimeHandlers(`) and every setting read (`config.…`), comments left out.
function wiring(file: string): string[] {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
  const names = code.match(
    /\b(?:create\w+|start\w+|realtimeHandlers)\(|(?<![\w./])config(?:\.\w+)+/g,
  );
  return [...new Set(names)].sort();
}

describe('crash-main.mjs', () => {
  it('makes the same ports and jobs from the same settings as main.ts', () => {
    const main = wiring('./main.ts');
    expect(main).toEqual(expect.arrayContaining(['createDbRefreshStore(', 'config.refresh']));
    expect(wiring('../test/support/crash-main.mjs')).toEqual(main);
  });
});
