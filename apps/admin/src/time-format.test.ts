// Every date the admin writes is in a named time zone (01/11, #494): a formatter without `timeZone` writes the server's zone (UTC)
// on the server and the browser's in the browser, so a page hydrates with other text (React #418). Read from the source, as
// permissions-sync.test.ts does; red → give the formatter its `timeZone`, never change this test.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('.', import.meta.url).pathname;

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.(test|d)\.ts$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

/** The arguments of the call opening at `open` (its "("), to the ")" that closes it. */
function callAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
    if (depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

describe('dates in a named time zone (#494)', () => {
  it('gives every Intl.DateTimeFormat a timeZone and never uses toLocale…String', () => {
    const found = sources(SRC).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const formatters = [...text.matchAll(/new Intl\.DateTimeFormat\(/g)].map((m) =>
        callAt(text, (m.index ?? 0) + m[0].length - 1),
      );
      return [
        ...formatters
          .filter((args) => !args.includes('timeZone'))
          .map(() => `${file}: no timeZone`),
        ...[...text.matchAll(/\.toLocale(Date|Time)?String\(/g)].map(
          () => `${file}: toLocale…String`,
        ),
      ];
    });
    expect(found).toEqual([]);
  });
});
