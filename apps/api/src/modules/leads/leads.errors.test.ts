import {
  InvalidCursorError,
  InvalidLeadOwnerError,
  InvalidLeadStageError,
  InvalidLostReasonError,
  LeadAccessDeniedError,
  LeadClosedError,
  LeadPipelineMissingError,
  LeadReferenceNotFoundError,
  LeadVersionConflictError,
} from '@gani/db';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ValidationFailedError } from '../../openapi/zod-pipe.js';
import { httpErrorOf } from './leads.errors.js';

describe('httpErrorOf (leads)', () => {
  it('answers each refusal of the lead store with its status and code, and lets any other error through as it is', () => {
    expect(httpErrorOf(new LeadAccessDeniedError())).toBeInstanceOf(ForbiddenException);
    expect(httpErrorOf(new InvalidCursorError())).toBeInstanceOf(ValidationFailedError);
    expect(httpErrorOf(new LeadReferenceNotFoundError())).toBeInstanceOf(NotFoundException);
    const coded = [
      new InvalidLeadStageError(),
      new LeadPipelineMissingError(),
      new InvalidLeadOwnerError(),
      new InvalidLostReasonError(),
      new LeadVersionConflictError(),
      new LeadClosedError(),
    ].map((e) => httpErrorOf(e) as { status: number; code: string });
    expect(coded.map(({ status, code }) => [status, code])).toEqual([
      [422, 'invalid_stage'],
      [422, 'invalid_stage'],
      [422, 'invalid_assignee'],
      [422, 'invalid_lost_reason'],
      [409, 'version_conflict'],
      [409, 'lead_closed'],
    ]);
    const other = new Error('boom');
    expect(httpErrorOf(other)).toBe(other);
  });
});
