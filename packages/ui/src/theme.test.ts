import { fileURLToPath } from 'node:url';

import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// Build the CSS Tailwind gives for a list of classes, with theme.css on top, as apps/admin will.
async function build(classes: string[]): Promise<string> {
  const from = fileURLToPath(new URL('./entry.css', import.meta.url));
  const input = `@import 'tailwindcss'; @import '../theme.css'; @source inline(${JSON.stringify(classes.join(' '))});`;
  const result = await postcss([
    tailwind({ base: fileURLToPath(new URL('.', import.meta.url)) }),
  ]).process(input, { from });
  return result.css;
}
const rule = (css: string, cls: string) =>
  new RegExp(`\\.${cls.replace(/[[\]#.()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1];

describe('theme.css', () => {
  it.each([
    ['bg-accent', 'var(--accent)'],
    ['text-text-muted', 'var(--text-muted)'],
    ['bg-note', 'var(--color-note)'],
    ['text-14', 'var(--fs-14)'],
    ['p-4', 'var(--sp-4)'],
    ['gap-2', 'var(--sp-2)'],
    ['rounded-card', 'var(--r-card)'],
    ['shadow-dialog', 'var(--shadow-dialog)'],
  ])('%s reads its token', async (cls, value) => {
    expect(rule(await build([cls]), cls)).toContain(value);
  });

  // Tailwind's own scales are gone: a colour, size, step or radius that is not a token gives no CSS at all.
  it.each(['bg-red-500', 'text-white', 'text-sm', 'p-0.5', 'p-12', 'rounded-lg', 'shadow-md'])(
    '%s gives no CSS',
    async (cls) => {
      expect(rule(await build([cls]), cls)).toBeUndefined();
    },
  );

  it('sets the font of the page to Inter from the token', async () => {
    expect(rule(await build(['font-sans']), 'font-sans')).toContain('var(--font)');
  });
});
