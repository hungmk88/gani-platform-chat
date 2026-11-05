import { InvalidCursorError, LeadAccessDeniedError } from '@gani/db';
import { ForbiddenException } from '@nestjs/common';

import { ValidationFailedError } from '../../openapi/zod-pipe.js';

// The answers of the lead paths to the refusals of the lead store (N188, N196). Messages are fixed sentences: no user data.

/** The HTTP answer of a refusal of the store; any other error as it is. */
export function httpErrorOf(error: unknown): unknown {
  if (error instanceof LeadAccessDeniedError) return new ForbiddenException();
  if (error instanceof InvalidCursorError) return new ValidationFailedError(['cursor: invalid']);
  return error;
}
