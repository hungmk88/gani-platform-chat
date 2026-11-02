import {
  InvalidTicketAssigneeError,
  InvalidTicketTransitionError,
  TicketCancelForbiddenError,
  TicketNotFoundError,
  TicketReferenceNotFoundError,
  TicketVersionConflictError,
} from '@gani/db';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { httpErrorOf } from './tickets.errors.js';

describe('httpErrorOf', () => {
  it('answers each refusal of the ticket store with its status and code, and leaves any other error as it is', () => {
    expect(httpErrorOf(new TicketNotFoundError())).toBeInstanceOf(NotFoundException);
    expect(httpErrorOf(new TicketReferenceNotFoundError())).toBeInstanceOf(NotFoundException);
    expect(httpErrorOf(new TicketCancelForbiddenError())).toBeInstanceOf(ForbiddenException);
    const coded = [
      new InvalidTicketAssigneeError(),
      new TicketVersionConflictError(),
      new InvalidTicketTransitionError('cancelled', 'new'),
    ].map((e) => httpErrorOf(e) as { status: number; code: string });
    expect(coded.map(({ status, code }) => [status, code])).toEqual([
      [422, 'invalid_assignee'],
      [409, 'version_conflict'],
      [409, 'invalid_transition'],
    ]);
    const other = new Error('x');
    expect(httpErrorOf(other)).toBe(other);
  });
});
