import {
  FieldHasDataError,
  FieldLimitError,
  FieldNotFoundError,
  FieldValueInvalidError,
} from '@gani/db';
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  FieldKeysMissingHttpError,
  fieldHttpErrorOf,
  fieldValueHttpErrorOf,
} from './customer-fields.errors.js';
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

  it('answers the refusals of the value store: 404 for a field not of the company, 422, and 503 without a key', () => {
    expect(fieldValueHttpErrorOf(new FieldNotFoundError())).toBeInstanceOf(NotFoundException);
    const invalid = fieldValueHttpErrorOf(new FieldValueInvalidError()) as {
      status: number;
      code: string;
    };
    expect([invalid.status, invalid.code]).toEqual([422, 'invalid_field_value']);
    const keys = new FieldKeysMissingHttpError();
    expect([keys.status, keys.code]).toEqual([503, 'service_unavailable']);
    const other = new Error('x');
    expect(fieldValueHttpErrorOf(other)).toBe(other);
  });

  it('lets only an Owner or an Admin define fields', () => {
    const roles = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'] as const;
    expect(roles.filter((r) => mayManageFields(r))).toEqual(['owner', 'admin']);
  });
});
