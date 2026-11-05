import { InvalidCursorError, LeadAccessDeniedError } from '@gani/db';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ValidationFailedError } from '../../openapi/zod-pipe.js';
import { httpErrorOf } from './leads.errors.js';

describe('httpErrorOf (leads)', () => {
  it('answers Support 403 and a foreign cursor 400, and lets any other error through as it is', () => {
    expect(httpErrorOf(new LeadAccessDeniedError())).toBeInstanceOf(ForbiddenException);
    expect(httpErrorOf(new InvalidCursorError())).toBeInstanceOf(ValidationFailedError);
    const other = new Error('boom');
    expect(httpErrorOf(other)).toBe(other);
  });
});
