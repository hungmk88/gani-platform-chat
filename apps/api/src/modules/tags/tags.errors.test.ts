import { TagHiddenError, TagLimitError, TagNameTakenError, TagNotFoundError } from '@gani/db';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { tagHttpErrorOf } from './tags.errors.js';

describe('tagHttpErrorOf', () => {
  it('answers each refusal of the tag store with its status and code, and leaves any other error as it is', () => {
    expect(tagHttpErrorOf(new TagNotFoundError())).toBeInstanceOf(NotFoundException);
    const coded = [new TagNameTakenError(), new TagLimitError(), new TagHiddenError()].map(
      (e) => tagHttpErrorOf(e) as { status: number; code: string },
    );
    expect(coded.map(({ status, code }) => [status, code])).toEqual([
      [409, 'duplicate_resource'],
      [422, 'tag_limit_reached'],
      [422, 'tag_hidden'],
    ]);
    const other = new Error('x');
    expect(tagHttpErrorOf(other)).toBe(other);
  });
});
