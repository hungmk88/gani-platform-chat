import {
  InvalidTicketAssigneeError,
  InvalidTicketTransitionError,
  TicketCancelForbiddenError,
  TicketNotFoundError,
  TicketReferenceNotFoundError,
  TicketVersionConflictError,
} from '@gani/db';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

// The answers of /v1/tickets to the refusals of the ticket store (K1c, N167, U52). Messages are fixed sentences: no user data.

/** 422 of an assignee who is not an active Owner, Admin, Manager or Support of the workspace (U52): one answer for every reason. */
export class TicketAssigneeHttpError extends Error {
  readonly status = 422;
  readonly code = 'invalid_assignee';
  constructor() {
    super('This person cannot receive a ticket of this workspace.');
    this.name = 'TicketAssigneeHttpError';
  }
}

/** 409: the ticket changed since the version the client read; read it again. */
export class TicketVersionHttpError extends Error {
  readonly status = 409;
  readonly code = 'version_conflict';
  constructor() {
    super('The ticket changed since it was read.');
    this.name = 'TicketVersionHttpError';
  }
}

/** 409: this status cannot follow the current one (N167). */
export class TicketTransitionHttpError extends Error {
  readonly status = 409;
  readonly code = 'invalid_transition';
  constructor() {
    super('The ticket cannot move to this status from its current one.');
    this.name = 'TicketTransitionHttpError';
  }
}

/** The HTTP answer of a refusal of the store; any other error as it is. */
export function httpErrorOf(error: unknown): unknown {
  if (error instanceof TicketNotFoundError || error instanceof TicketReferenceNotFoundError)
    return new NotFoundException();
  if (error instanceof TicketCancelForbiddenError) return new ForbiddenException();
  if (error instanceof InvalidTicketAssigneeError) return new TicketAssigneeHttpError();
  if (error instanceof TicketVersionConflictError) return new TicketVersionHttpError();
  if (error instanceof InvalidTicketTransitionError) return new TicketTransitionHttpError();
  return error;
}
