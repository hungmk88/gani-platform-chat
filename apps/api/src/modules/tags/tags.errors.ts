import { TagLimitError, TagNameTakenError } from '@gani/db';

// The answers of /v1/tags to the refusals of the tag store (N190). Messages are fixed sentences: no user data.

/** 409: another tag of the company has this name, whatever the case. */
export class TagNameTakenHttpError extends Error {
  readonly status = 409;
  readonly code = 'duplicate_resource';
  constructor() {
    super('Another tag of the company has this name.');
    this.name = 'TagNameTakenHttpError';
  }
}

/** 422: the company has 500 tags already. */
export class TagLimitHttpError extends Error {
  readonly status = 422;
  readonly code = 'tag_limit_reached';
  constructor() {
    super('The company has the most tags it may have.');
    this.name = 'TagLimitHttpError';
  }
}

/** The HTTP error of a refusal of the store; anything else as it is. */
export function tagHttpErrorOf(error: unknown): unknown {
  if (error instanceof TagNameTakenError) return new TagNameTakenHttpError();
  if (error instanceof TagLimitError) return new TagLimitHttpError();
  return error;
}
