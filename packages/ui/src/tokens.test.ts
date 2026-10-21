import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrast, parseHex, readTokens } from './contrast.js';

const tokens = readTokens(readFileSync(new URL('../tokens.css', import.meta.url), 'utf8'));
const token = (name: string) => {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`no token --${name}`);
  return value;
};
const px = (name: string) => Number(/^(\d+)px$/.exec(token(name))?.[1]);

describe('tokens.css', () => {
  // Text on the background it is drawn on (WCAG 2.1 AA 1.4.3: 4.5:1 for text up to 20px, the largest size here).
  it.each([
    ['text', 'bg'],
    ['text', 'bg-subtle'],
    ['text-muted', 'bg'],
    ['text-muted', 'bg-subtle'],
    ['accent', 'bg'],
    ['accent-on', 'accent'],
    ['ok-text', 'ok-bg'],
    ['warn-text', 'warn-bg'],
    ['error-text', 'error-bg'],
    ['color-note-text', 'color-note'],
  ])('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  // The edge of an input or a button against the page (1.4.11, non-text: 3:1).
  it('border-strong reaches 3:1 on both backgrounds', () => {
    expect(contrast(token('border-strong'), token('bg'))).toBeGreaterThanOrEqual(3);
    expect(contrast(token('border-strong'), token('bg-subtle'))).toBeGreaterThanOrEqual(3);
  });

  it('has the four font sizes of Brief UI and no other', () => {
    const sizes = [...tokens.keys()].filter((k) => k.startsWith('fs-')).map(px);
    expect(sizes).toEqual([12, 14, 16, 20]);
  });

  it('puts every spacing and radius on the 4px grid', () => {
    const steps = [...tokens.keys()].filter((k) => /^(sp|r)-/.test(k));
    expect(steps.length).toBeGreaterThan(0);
    for (const k of steps) expect(px(k) % 4, k).toBe(0);
  });

  it('keeps motion at 200ms or less', () => {
    expect(Number(/^(\d+)ms$/.exec(token('motion'))?.[1])).toBeLessThanOrEqual(200);
  });
});

describe('contrast', () => {
  it('gives 21 for black on white and 1 for a colour on itself', () => {
    expect(contrast('#000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#1d4ed8', '#1d4ed8')).toBe(1);
  });

  it('refuses what is not a hex colour', () => {
    expect(() => parseHex('rgb(0 0 0)')).toThrow('not a hex colour');
  });
});
