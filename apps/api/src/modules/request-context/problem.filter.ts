import { randomUUID } from 'node:crypto';
import { STATUS_CODES, type ServerResponse } from 'node:http';

import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

import { problem, sendProblem, type Problem } from './problem.js';
import { requestTraceId } from './request-context.js';

// Review AR-03: one error contract for every route of Nest (RFC 9457, apps/api/CLAUDE.md). The middleware and the gate already answer
// with problem(); this filter does the same for whatever a controller or Nest itself throws.
//
// - An HttpException of Nest (404 of the router, 405, a pipe's 400): its status, and the code of Brief P9 for it (not_found).
//   Codes are snake_case everywhere (P9, N132).
// - An error of ours that names its status (400-599) and its code (conversations/errors.ts): those, with its message as the detail. By
//   convention those messages are fixed sentences that hold no user data (errors.ts says so for each class).
// - The domain's InvalidTransitionError (code invalid_transition, no status): 409.
// - Anything else: 500 internal_error with a traceId (the request's own, when the tenant middleware gave it one). The log line holds the traceId and the error's name and code, never its message,
//   which can hold a query and its parameters (review SEC-01).

// The codes of Brief P9's table where it names one for the status; otherwise the status name in snake_case (405 method_not_allowed).
const P9_CODES: Readonly<Record<number, string>> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
  429: 'rate_limited',
  500: 'internal_error',
};
export const codeOfStatus = (status: number): string =>
  P9_CODES[status] ??
  (STATUS_CODES[status] ?? 'Error')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// A code worth a log line: also a SQLSTATE (57014) or a system code (ECONNREFUSED); never free text.
const LOG_CODE = /^[A-Za-z0-9_]{1,64}$/;

interface Named {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly status?: unknown;
  readonly message?: unknown;
}

export function toProblem(exception: unknown, traceId: string): Problem {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return problem(status, codeOfStatus(status), undefined, status >= 500 ? traceId : undefined);
  }
  const e = (typeof exception === 'object' && exception !== null ? exception : {}) as Named;
  const code = typeof e.code === 'string' && CODE.test(e.code) ? e.code : undefined;
  const detail = typeof e.message === 'string' ? e.message : undefined;
  if (code && typeof e.status === 'number' && e.status >= 400 && e.status <= 599) {
    return problem(e.status, code, e.status < 500 ? detail : undefined, traceId);
  }
  if (code === 'invalid_transition') return problem(409, code, detail, traceId);
  return problem(500, 'internal_error', 'Something went wrong. Try again.', traceId);
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ServerResponse>();
    const traceId = requestTraceId() ?? randomUUID();
    const body = toProblem(exception, traceId);
    if (body.status >= 500) {
      const e = (typeof exception === 'object' && exception !== null ? exception : {}) as Named;
      const name = typeof e.name === 'string' ? e.name : 'unknown';
      const code = typeof e.code === 'string' && LOG_CODE.test(e.code) ? e.code : 'none';
      this.logger.error(`request failed (${name}, ${code}) trace=${traceId}`);
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    sendProblem(res, body);
  }
}

/**
 * Express error middleware for what fails before Nest's router: the JSON parser (malformed body 400, body too large 413). Mounted right
 * after the parser in setupApp, so those answers are problem+json too. Any other error goes on to the next handler.
 */
export function parserErrors(
  error: unknown,
  _req: unknown,
  res: ServerResponse,
  next: (error?: unknown) => void,
): void {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || status < 400 || status > 499) return next(error);
  sendProblem(res, problem(status, codeOfStatus(status), 'The request body could not be read.'));
}
