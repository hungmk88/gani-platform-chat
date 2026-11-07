import { describe, expect, it } from 'vitest';

import type { Tag } from '../customer-data/catalog';
import { chosenTags, tagChoices, tagFailureOf, tagsPath } from './customer-tags';

const tag = (n: number, name: string, hidden = false): Tag => ({
  id: `t${n}`,
  name,
  hidden,
  customerCount: 0,
  createdAt: '2026-10-20T03:00:00.000Z',
  updatedAt: '2026-10-20T03:00:00.000Z',
});
const ALL = [
  tag(1, 'Khách sỉ'),
  tag(2, 'Quán ăn'),
  tag(3, 'Thử nghiệm cũ', true),
  tag(4, 'Đại lý', true),
];

describe('tagsPath', () => {
  it('under the customer, the id encoded', () => {
    expect(tagsPath('a/b')).toBe('/v1/customers/a%2Fb/tags');
  });
});

describe('tagChoices (T-4)', () => {
  it('every tag not hidden; a hidden one only when the customer has it; by name', () => {
    const has = [{ id: 't4', name: 'Đại lý', hidden: true }];
    expect(tagChoices(ALL, has).map((t) => t.name)).toEqual(['Đại lý', 'Khách sỉ', 'Quán ăn']);
    expect(tagChoices(ALL, []).map((t) => t.id)).toEqual(['t1', 't2']);
  });
  it('one the customer has that the list no longer gives still shows, to be taken off', () => {
    const gone = { id: 't9', name: 'Bán lẻ', hidden: false };
    expect(tagChoices(ALL, [gone]).map((t) => t.id)).toEqual(['t9', 't1', 't2']);
  });
  it('the chosen ones, in the order of the choices', () => {
    const choices = tagChoices(ALL, []);
    expect(chosenTags(choices, new Set(['t2', 't1']))).toEqual([
      { id: 't1', name: 'Khách sỉ', hidden: false },
      { id: 't2', name: 'Quán ăn', hidden: false },
    ]);
  });
});

describe('tagFailureOf', () => {
  it('a hidden tag, or a tag or customer gone: say so and read again; anything else: the sentence of the API', () => {
    expect(tagFailureOf({ code: 'tag_hidden', message: 'x' })).toEqual({
      text: 'Có tag vừa bị ẩn, không gắn mới được. Danh sách tag đã tải lại.',
      again: true,
    });
    expect(tagFailureOf({ code: 'not_found', message: 'x' }).again).toBe(true);
    expect(tagFailureOf({ code: 'forbidden', message: 'API' })).toEqual({
      text: 'API',
      again: false,
    });
  });
});
