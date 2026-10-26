import { describe, expect, it } from 'vitest';

import { phonePrefix, toE164 } from './phone.js';

describe('toE164', () => {
  it('turns the ways a Vietnamese number is written into +84…', () => {
    for (const typed of [
      '0912345678',
      '0912 345 678',
      '0912.345.678',
      '(091) 234-5678',
      '84912345678',
      '+84 912 345 678',
      '0084912345678',
    ])
      expect(toE164(typed), typed).toBe('+84912345678');
    expect(toE164('+1 (415) 555-0100')).toBe('+14155550100');
  });

  it('refuses what is not a whole number: letters, too short, too long, a leading zero after the country, no country', () => {
    for (const typed of [
      '',
      'abc',
      '09123',
      '+0912345678',
      '+1234567890123456',
      '912345678',
      '0912345678x',
      '++84912345678',
    ])
      expect(toE164(typed), typed).toBeNull();
  });
});

describe('phonePrefix', () => {
  it('gives the start of a number in the stored form, from 3 digits on', () => {
    expect(phonePrefix('0912')).toBe('+84912');
    expect(phonePrefix('+84 91')).toBe('+8491');
    expect(phonePrefix('091')).toBe('+8491');
  });

  it('refuses a name, fewer than 3 digits and a start that no number has', () => {
    for (const typed of ['Lan', '09', '+8', '+0912', '912'])
      expect(phonePrefix(typed), typed).toBeNull();
  });
});
