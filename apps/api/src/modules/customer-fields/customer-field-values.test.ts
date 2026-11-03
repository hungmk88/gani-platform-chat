import { describe, expect, it } from 'vitest';

import { fitFieldValue, MASK, valuesView } from './customer-field-values.js';

const fit = (type: string, value: unknown, options: string[] = []) =>
  fitFieldValue({ type, options }, value as never);

describe('customer field values', () => {
  it('takes what each type takes, normalised as the customers are, and nothing else', () => {
    expect(fit('text', ' Ghi chú ')).toBe(' Ghi chú ');
    expect(fit('number', 12.5)).toBe(12.5);
    expect(fit('date', '2028-02-29')).toBe('2028-02-29');
    expect(fit('select', 'Bắc', ['Bắc', 'Nam'])).toBe('Bắc');
    expect(fit('multiselect', ['Nam', 'Bắc'], ['Bắc', 'Nam'])).toEqual(['Nam', 'Bắc']);
    expect(fit('phone', '0912 345 678')).toBe('+84912345678');
    expect(fit('email', ' An@Example.VN ')).toBe('an@example.vn');
    for (const [type, value, options] of [
      ['text', 1],
      ['number', '12'],
      ['number', Infinity],
      ['date', '2027-02-29'],
      ['date', '29/02/2028'],
      ['date', 20280229],
      ['select', 'Tây', ['Bắc', 'Nam']],
      ['select', ['Bắc'], ['Bắc', 'Nam']],
      ['multiselect', ['Bắc', 'Bắc'], ['Bắc', 'Nam']],
      ['multiselect', ['Tây'], ['Bắc', 'Nam']],
      ['multiselect', 'Bắc', ['Bắc', 'Nam']],
      ['phone', '12'],
      ['phone', 912345678],
      ['email', 'not-an-email'],
      ['email', 5],
      ['color', 'red'],
    ] as [string, unknown, string[]?][])
      expect(fit(type, value, options), `${type} ${JSON.stringify(value)}`).toBeUndefined();
  });

  it('gives a sensitive value not opened as the mask, every other value as it is', () => {
    expect(
      valuesView([
        { fieldId: 'a', value: ['Bắc'], sealed: false },
        { fieldId: 'b', value: null, sealed: true },
      ]),
    ).toEqual({
      data: [
        { fieldId: 'a', value: ['Bắc'] },
        { fieldId: 'b', value: MASK },
      ],
    });
    expect(MASK).toBe('••••');
  });
});
