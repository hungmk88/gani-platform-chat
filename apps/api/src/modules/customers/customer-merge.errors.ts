import {
  CustomerMergeNotFoundError,
  CustomerNotMergedError,
  MergeTargetMergedError,
} from '@gani/db';
import { NotFoundException } from '@nestjs/common';

// The answers of the merge endpoints to the refusals of the merge store (J3c, contract J3-0). Fixed sentences: no customer data.

/** 409: the customer is not merged into another. */
export class NotMergedHttpError extends Error {
  readonly status = 409;
  readonly code = 'not_merged';
  constructor() {
    super('The customer is not merged into another.');
    this.name = 'NotMergedHttpError';
  }
}

/** 409: the target was merged in turn; unmerge that one first. */
export class TargetMergedHttpError extends Error {
  readonly status = 409;
  readonly code = 'target_merged';
  constructor() {
    super('The target was merged in turn: unmerge it first.');
    this.name = 'TargetMergedHttpError';
  }
}

/** The HTTP answer of a refusal of the store; any other error as it is. */
export function mergeHttpErrorOf(error: unknown): unknown {
  if (error instanceof CustomerMergeNotFoundError) return new NotFoundException();
  if (error instanceof CustomerNotMergedError) return new NotMergedHttpError();
  if (error instanceof MergeTargetMergedError) return new TargetMergedHttpError();
  return error;
}
