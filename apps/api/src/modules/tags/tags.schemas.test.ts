import { describe, expect, it } from 'vitest';

import { CustomerTagsChangeSchema, TagChangeSchema, TagCreateSchema } from './tags.schemas.js';

const id = (n: number) => `01900000-0000-7000-8000-00000000000${n}`;
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

// The rules the planned contract of the tags states (T-4, U47), checked before any module is built.
describe('the tag contract', () => {
  it('names a tag in 1–50 characters, trimmed, and changes at least one thing', () => {
    expect(TagCreateSchema.parse({ name: ' Khách sỉ ' }).name).toBe('Khách sỉ');
    expect(ok(TagCreateSchema, { name: '  ' })).toBe(false);
    expect(ok(TagCreateSchema, { name: 'x'.repeat(51) })).toBe(false);
    expect(ok(TagChangeSchema, { hidden: true })).toBe(true);
    expect(ok(TagChangeSchema, {})).toBe(false);
  });

  it('sets a customer’s whole set of tags, each once', () => {
    expect(ok(CustomerTagsChangeSchema, { tagIds: [] })).toBe(true);
    expect(ok(CustomerTagsChangeSchema, { tagIds: [id(1), id(2)] })).toBe(true);
    expect(ok(CustomerTagsChangeSchema, { tagIds: [id(1), id(1)] })).toBe(false);
  });
});
