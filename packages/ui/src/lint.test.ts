import css from '@eslint/css';
import { rawCssSelectors, rawHtmlSelectors, rawStyleSelectors } from '@gani/config/ui-lint';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

// The selectors apps/admin gets from packages/config/eslint.config.mjs, run on a line of JSX.
const linter = new Linter();
const errors = (code: string) =>
  linter.verify(code, {
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'no-restricted-syntax': ['error', ...rawStyleSelectors] },
  }).length;

describe('the token lint of apps/admin', () => {
  it.each([
    '<p className="text-[13px]" />',
    '<p className="hover:bg-[#ff0000] p-4" />',
    '<p className="p-[5px]" />',
    'const c = cn("rounded-[6px]", x);',
    'const c = `mt-[3px] ${x}`;',
    'const red = "#f00";',
    'const red = "rgb(255 0 0)";',
    '<p style={{ color: "red" }} />',
    '<p style={{ fontSize: 13 }} />',
  ])('refuses %s', (code) => {
    expect(errors(code)).toBeGreaterThan(0);
  });

  it.each([
    '<p className="text-14 text-text-muted p-4 rounded-card" />',
    '<aside className="w-[240px] min-h-[100dvh]" />',
    '<p>Xem yêu cầu #128</p>',
    '<p style={{ width: 240 }} />',
    'const c = `bg-accent ${x}`;',
  ])('allows %s', (code) => {
    expect(errors(code)).toBe(0);
  });
});

describe('the plain-text lint of apps/admin (T2)', () => {
  const html = (code: string) =>
    linter.verify(code, {
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: { 'no-restricted-syntax': ['error', ...rawHtmlSelectors] },
    }).length;

  it.each([
    '<p dangerouslySetInnerHTML={{ __html: body }} />',
    'el.innerHTML = body;',
    'node.outerHTML = body;',
    'el.insertAdjacentHTML("beforeend", body);',
  ])('refuses %s', (code) => {
    expect(html(code)).toBeGreaterThan(0);
  });

  it.each(['<p>{body}</p>', 'const t = el.innerHTML;', 'el.textContent = body;'])(
    'allows %s',
    (code) => {
      expect(html(code)).toBe(0);
    },
  );
});

describe('the stylesheet lint of apps/admin', () => {
  const problems = (code: string) =>
    linter.verify(
      code,
      [
        {
          files: ['**/*.css'],
          language: 'css/css',
          plugins: { css },
          rules: { 'no-restricted-syntax': ['error', ...rawCssSelectors] },
        },
      ],
      'app.css',
    ).length;

  it.each([
    'a { color: #fff; }',
    'a { background: rgb(0 0 0); }',
    'a { font-size: 13px; }',
    'a { margin: 1rem; }',
  ])('refuses %s', (code) => {
    expect(problems(code)).toBeGreaterThan(0);
  });

  it.each([
    'a { color: var(--text); padding: var(--sp-4); border-radius: var(--r-card); }',
    "@import 'tailwindcss'; @import '@gani/ui/theme.css';",
    '#main { width: 100%; }',
  ])('allows %s', (code) => {
    expect(problems(code)).toBe(0);
  });
});
