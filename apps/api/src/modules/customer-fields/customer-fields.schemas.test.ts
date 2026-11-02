import { describe, expect, it } from 'vitest';

import {
  CustomerFieldChangeSchema,
  CustomerFieldCreateSchema,
  CustomerFieldValuesChangeSchema,
} from './customer-fields.schemas.js';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

// The rules the planned contract of the custom fields states (U46), checked before any module is built.
describe('the custom field contract', () => {
  it('gives two choices or more to select and multiselect, and choices to nothing else', () => {
    expect(
      ok(CustomerFieldCreateSchema, { name: 'Khu vực', type: 'select', options: ['Q1', 'Q3'] }),
    ).toBe(true);
    expect(
      ok(CustomerFieldCreateSchema, { name: 'Khu vực', type: 'select', options: ['Q1'] }),
    ).toBe(false);
    expect(ok(CustomerFieldCreateSchema, { name: 'Khu vực', type: 'multiselect' })).toBe(false);
    expect(
      ok(CustomerFieldCreateSchema, { name: 'Ghi chú', type: 'text', options: ['a', 'b'] }),
    ).toBe(false);
    expect(
      ok(CustomerFieldCreateSchema, { name: 'Khu vực', type: 'select', options: ['Q1', 'Q1'] }),
    ).toBe(false);
    expect(CustomerFieldCreateSchema.parse({ name: 'Ngày sinh', type: 'date' })).toMatchObject({
      required: false,
      sensitive: false,
    });
    expect(ok(CustomerFieldChangeSchema, {})).toBe(false);
  });

  it('changes some values of a customer, each field once, null clearing one', () => {
    const field = '01900000-0000-7000-8000-000000000001';
    expect(ok(CustomerFieldValuesChangeSchema, { values: [{ fieldId: field, value: null }] })).toBe(
      true,
    );
    expect(
      ok(CustomerFieldValuesChangeSchema, { values: [{ fieldId: field, value: ['a', 'b'] }] }),
    ).toBe(true);
    expect(ok(CustomerFieldValuesChangeSchema, { values: [] })).toBe(false);
    const twice = {
      values: [
        { fieldId: field, value: 1 },
        { fieldId: field, value: 2 },
      ],
    };
    expect(ok(CustomerFieldValuesChangeSchema, twice)).toBe(false);
  });
});
