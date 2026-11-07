import { describe, expect, it } from 'vitest';

import type { CustomerField } from '../customer-data/catalog';
import {
  changesOf,
  draftOf,
  fieldRows,
  fieldsFailureOf,
  fieldsPath,
  valueOf,
  valueText,
} from './customer-fields';

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
const PICK = { options: ['Zalo', 'Hội chợ'] };

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

describe('valueOf (as fitFieldValue of the API)', () => {
  it('blank or no choice clears; text up to 1000', () => {
    expect(valueOf(field(1, 'text'), '  ')).toEqual({ ok: true, value: null });
    expect(valueOf(field(1, 'multiselect', PICK), [])).toEqual({ ok: true, value: null });
    expect(valueOf(field(1, 'text'), ' Quán ')).toEqual({ ok: true, value: 'Quán' });
    expect(valueOf(field(1, 'text'), 'a'.repeat(1001))).toEqual({
      ok: false,
      problem: 'Trường 1: dài quá 1000 ký tự.',
    });
  });
  it('a number with a comma; a phone in E.164; an email in lower case; a choice of the field', () => {
    expect(valueOf(field(1, 'number'), '2,5')).toEqual({ ok: true, value: 2.5 });
    expect(valueOf(field(1, 'number'), '1 500')).toEqual({ ok: true, value: 1500 });
    expect(valueOf(field(1, 'number'), 'mười').ok).toBe(false);
    expect(valueOf(field(1, 'phone'), '0912 345 678')).toEqual({ ok: true, value: '+84912345678' });
    expect(valueOf(field(1, 'phone'), '12').ok).toBe(false);
    expect(valueOf(field(1, 'email'), ' Ke.Toan@Example.Test ')).toEqual({
      ok: true,
      value: 'ke.toan@example.test',
    });
    expect(valueOf(field(1, 'email'), 'ke toan').ok).toBe(false);
    expect(valueOf(field(1, 'select', PICK), 'Zalo')).toEqual({ ok: true, value: 'Zalo' });
    expect(valueOf(field(1, 'select', PICK), 'Facebook').ok).toBe(false);
    expect(valueOf(field(1, 'date'), '2026-11-07')).toEqual({ ok: true, value: '2026-11-07' });
  });
});

describe('changesOf', () => {
  const fields = [field(1, 'text'), field(2, 'multiselect', PICK), field(3, 'number')];
  const before = draftOf(fields, [
    { fieldId: 'f1', value: 'Quán' },
    { fieldId: 'f2', value: ['Zalo'] },
    { fieldId: 'f3', value: 12 },
  ]);
  it('reads the values into the form', () => {
    expect(before).toEqual({ f1: 'Quán', f2: ['Zalo'], f3: '12' });
  });
  it('only what changed; blank clears; choices in any order are the same', () => {
    expect(changesOf(fields, before, { ...before, f2: ['Zalo'] })).toBeNull();
    expect(changesOf(fields, before, { ...before, f1: '', f2: ['Hội chợ', 'Zalo'] })).toEqual({
      values: [
        { fieldId: 'f1', value: null },
        { fieldId: 'f2', value: ['Hội chợ', 'Zalo'] },
      ],
    });
  });
  it('the first value that cannot go says why', () => {
    expect(changesOf(fields, before, { ...before, f3: 'x' })).toBe(
      'Trường 3: phải là số (ví dụ 1500 hoặc 2,5).',
    );
  });
});

describe('fieldsFailureOf', () => {
  it('a wrong value or a field gone reads again; anything else is the sentence of the API', () => {
    expect(fieldsFailureOf({ code: 'invalid_field_value', message: 'x' }).again).toBe(true);
    expect(fieldsFailureOf({ code: 'not_found', message: 'x' }).again).toBe(true);
    expect(fieldsFailureOf({ code: 'forbidden', message: 'API' })).toEqual({
      text: 'API',
      again: false,
    });
  });
});
