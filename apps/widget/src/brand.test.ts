import { describe, expect, it } from 'vitest';

import { brandColor, brandOf, contrast, NEUTRAL } from './brand';

describe('contrast', () => {
  it('measures as WCAG 2.1 does, in either order', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    expect(contrast('#ffffff', '#767676')).toBeCloseTo(contrast('#767676', '#ffffff'), 10);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThan(4.5);
  });
});

describe('brandColor', () => {
  it('keeps a brand colour that carries white text at 4.5:1, in lower case', () => {
    expect(brandColor(' #0F766E ')).toBe('#0f766e');
  });
  it('falls back to the neutral colour for a light, malformed or missing one', () => {
    expect(brandColor('#ffd700')).toBe(NEUTRAL);
    expect(brandColor('#777777')).toBe(NEUTRAL);
    expect(brandColor('red')).toBe(NEUTRAL);
    expect(brandColor('#0f766')).toBe(NEUTRAL);
    expect(brandColor(undefined)).toBe(NEUTRAL);
  });
});

describe('brandOf', () => {
  it('reads the attributes of the embed script, trimmed and cut to length', () => {
    expect(
      brandOf({ brandName: ' Thương hiệu A ', brandColor: '#0f766e', greeting: 'x'.repeat(250) }),
    ).toEqual({ name: 'Thương hiệu A', color: '#0f766e', greeting: 'x'.repeat(200) });
  });
  it('has words of its own when the page gives none', () => {
    expect(brandOf({ brandName: '  ' })).toEqual({
      name: 'Hỗ trợ khách hàng',
      color: NEUTRAL,
      greeting: 'Chào bạn, mình có thể giúp gì?',
    });
  });
});
