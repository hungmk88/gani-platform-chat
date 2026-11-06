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

import { ValidationFailedError } from '../../openapi/zod-pipe.js';

// The answers of the lead paths to the refusals of the lead store (N188, N196). Messages are fixed sentences: no user data.

/** A refusal with its status and code of the contract (problem+json through ProblemFilter). */
export class LeadHttpError extends Error {
  constructor(
    readonly status: 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LeadHttpError';
  }
}

/** The HTTP answer of a refusal of the store; any other error as it is. */
export function httpErrorOf(error: unknown): unknown {
  if (error instanceof LeadAccessDeniedError) return new ForbiddenException();
  if (error instanceof InvalidCursorError) return new ValidationFailedError(['cursor: invalid']);
  if (error instanceof LeadReferenceNotFoundError) return new NotFoundException();
  // A workspace without a pipeline has no step to start at: the same answer as a step that is not of it.
  if (error instanceof InvalidLeadStageError || error instanceof LeadPipelineMissingError)
    return new LeadHttpError(422, 'invalid_stage', 'Not a step of the workspace’s pipeline.');
  if (error instanceof InvalidLeadOwnerError)
    return new LeadHttpError(
      422,
      'invalid_assignee',
      'This person cannot follow a lead of this workspace.',
    );
  if (error instanceof InvalidLostReasonError)
    return new LeadHttpError(
      422,
      'invalid_lost_reason',
      'Not one of the workspace’s reasons to lose.',
    );
  if (error instanceof LeadVersionConflictError)
    return new LeadHttpError(409, 'version_conflict', 'The lead changed since it was read.');
  if (error instanceof LeadClosedError)
    return new LeadHttpError(409, 'lead_closed', 'The lead is won or lost, which is final.');
  return error;
}
