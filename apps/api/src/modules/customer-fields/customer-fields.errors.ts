import { FieldHasDataError, FieldLimitError } from '@gani/db';

// The answers of /v1/customer-fields to the refusals of the field store (N191). Messages are fixed sentences: no user data.

/** 422: the company has 50 live fields already. */
export class FieldLimitHttpError extends Error {
  readonly status = 422;
  readonly code = 'field_limit_reached';
  constructor() {
    super('The company has the most fields it may have.');
    this.name = 'FieldLimitHttpError';
  }
}

/** 409: the change needs a field no customer has a value for (its type, sensitivity, a choice in use, or its end). */
export class FieldHasDataHttpError extends Error {
  readonly status = 409;
  readonly code = 'field_has_data';
  constructor() {
    super('Some customer has a value for this field.');
    this.name = 'FieldHasDataHttpError';
  }
}

/** The HTTP error of a refusal of the store; anything else as it is. */
export function fieldHttpErrorOf(error: unknown): unknown {
  if (error instanceof FieldLimitError) return new FieldLimitHttpError();
  if (error instanceof FieldHasDataError) return new FieldHasDataHttpError();
  return error;
}
