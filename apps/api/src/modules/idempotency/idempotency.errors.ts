// Answers of an Idempotency-Key the request cannot be served under (Brief P9, N134). ProblemFilter answers them from status and code.

/** The key was used with another request (method, path or body): the client reused a key it should not have. */
export class IdempotencyKeyReusedError extends Error {
  readonly status = 422;
  readonly code = 'idempotency_key_reused';
  constructor() {
    super('This Idempotency-Key was used with another request.');
    this.name = 'IdempotencyKeyReusedError';
  }
}

/** The first request with the key is still running: try again in a moment, the answer will then be given back. */
export class IdempotencyInProgressError extends Error {
  readonly status = 409;
  readonly code = 'idempotency_in_progress';
  constructor() {
    super('A request with this Idempotency-Key is still in progress.');
    this.name = 'IdempotencyInProgressError';
  }
}
