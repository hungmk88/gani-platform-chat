import { TagLimitError, TagNameTakenError } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { tagHttpErrorOf } from './tags.errors.js';

describe('tagHttpErrorOf', () => {
  it('answers each refusal of the tag store with its status and code, and leaves any other error as it is', () => {
    const coded = [new TagNameTakenError(), new TagLimitError()].map(
      (e) => tagHttpErrorOf(e) as { status: number; code: string },
    );
    expect(coded.map(({ status, code }) => [status, code])).toEqual([
      [409, 'duplicate_resource'],
      [422, 'tag_limit_reached'],
    ]);
    const other = new Error('x');
    expect(tagHttpErrorOf(other)).toBe(other);
  });
});
