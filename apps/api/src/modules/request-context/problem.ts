import { STATUS_CODES, type ServerResponse } from 'node:http';

// RFC 9457 error body (apps/api/CLAUDE.md). `code` is our extension member: the stable word a client switches on.
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface Problem {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
}

/** `detail` is for a person reading the response: never put a secret, an id of another tenant or a driver message in it. */
export function problem(status: number, code: string, detail?: string): Problem {
  const base = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
  } as const;
  return detail === undefined ? base : { ...base, detail };
}

/** For code that runs before Nest's own exception filters (middleware, the edge gate). */
export function sendProblem(res: ServerResponse, body: Problem): void {
  const json = JSON.stringify(body);
  res.statusCode = body.status;
  res.setHeader('content-type', PROBLEM_CONTENT_TYPE);
  res.setHeader('content-length', Buffer.byteLength(json));
  res.setHeader('cache-control', 'no-store');
  res.end(json);
}
