import {
  FieldHasDataError,
  FieldLimitError,
  FieldNotFoundError,
  FieldValueInvalidError,
} from '@gani/db';
import { NotFoundException } from '@nestjs/common';

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

/** 422: a value of the wrong type for its field, or not one of its choices. */
export class FieldValueInvalidHttpError extends Error {
  readonly status = 422;
  readonly code = 'invalid_field_value';
  constructor() {
    super('A value does not fit its field.');
    this.name = 'FieldValueInvalidHttpError';
  }
}

/** 503: no CHANNEL_SECRET_KEY_<version> is set, so a sensitive value can be neither sealed nor opened (CEO 03/11 answer 4). */
export class FieldKeysMissingHttpError extends Error {
  readonly status = 503;
  readonly code = 'service_unavailable';
  constructor() {
    super('A sensitive value cannot be sealed or opened now.');
    this.name = 'FieldKeysMissingHttpError';
  }
}

/** The HTTP error of a refusal of the value store; anything else as it is. */
export function fieldValueHttpErrorOf(error: unknown): unknown {
  if (error instanceof FieldNotFoundError) return new NotFoundException();
  if (error instanceof FieldValueInvalidError) return new FieldValueInvalidHttpError();
  return error;
}
