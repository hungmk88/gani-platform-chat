import { describe, expect, it } from 'vitest';

import type { CustomerField } from '../customer-data/catalog';
import { fieldRows, fieldsPath, valueText } from './customer-fields';

const field = (
  n: number,
  type: CustomerField['type'],
  more: Partial<CustomerField> = {},
): CustomerField => ({
  id: `f${n}`,
  name: `Trường ${n}`,
  type,
  options: [],
  required: false,
  sensitive: false,
  hidden: false,
  position: n,
  hasData: false,
  createdAt: '2026-10-20T03:00:00.000Z',
  updatedAt: '2026-10-20T03:00:00.000Z',
  ...more,
});

describe('fieldsPath', () => {
  it('under the customer, the id encoded', () => {
    expect(fieldsPath('a/b')).toBe('/v1/customers/a%2Fb/fields');
  });
});

describe('valueText', () => {
  it('none, masked, a number, a day, choices, a phone, text', () => {
    expect(valueText(field(1, 'text'), null)).toBe('Chưa có');
    expect(valueText(field(1, 'multiselect'), [])).toBe('Chưa có');
    expect(valueText(field(1, 'phone', { sensitive: true }), '••••')).toBe('••••');
    expect(valueText(field(1, 'number'), 1500.5)).toBe('1.500,5');
    expect(valueText(field(1, 'date'), '2026-11-07')).toBe('07/11/2026');
    expect(valueText(field(1, 'multiselect'), ['Phở khô', 'Bún'])).toBe('Phở khô, Bún');
    expect(valueText(field(1, 'phone'), '+84912345678')).toBe('0912 345 678');
    expect(valueText(field(1, 'text'), 'Quán Ba Miền')).toBe('Quán Ba Miền');
  });
});

describe('fieldRows', () => {
  it('by position; a hidden field only with a value', () => {
    const fields = [
      field(3, 'text'),
      field(1, 'text'),
      field(2, 'text', { hidden: true }),
      field(4, 'text', { hidden: true }),
    ];
    const rows = fieldRows(fields, [{ fieldId: 'f2', value: 'có' }]);
    expect(rows.map((r) => [r.field.id, r.value])).toEqual([
      ['f1', null],
      ['f2', 'có'],
      ['f3', null],
    ]);
  });
});
