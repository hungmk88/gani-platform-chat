import { FieldHasDataError, FieldLimitError } from '@gani/db';
import { describe, expect, it } from 'vitest';

import { fieldHttpErrorOf } from './customer-fields.errors.js';
import { mayManageFields } from './customer-fields.permissions.js';

describe('customer fields', () => {
  it('answers each refusal of the store with its status and code, and leaves any other error as it is', () => {
    const coded = [new FieldLimitError(), new FieldHasDataError()].map(
      (e) => fieldHttpErrorOf(e) as { status: number; code: string },
    );
    expect(coded.map(({ status, code }) => [status, code])).toEqual([
      [422, 'field_limit_reached'],
      [409, 'field_has_data'],
    ]);
    const other = new Error('x');
    expect(fieldHttpErrorOf(other)).toBe(other);
  });

  it('lets only an Owner or an Admin define fields', () => {
    const roles = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'] as const;
    expect(roles.filter((r) => mayManageFields(r))).toEqual(['owner', 'admin']);
  });
});
