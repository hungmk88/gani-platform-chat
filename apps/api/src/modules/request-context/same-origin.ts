import type { IncomingMessage, ServerResponse } from 'node:http';

import { problem, sendProblem } from './problem.js';

// Brief P17 (CSRF), N136: a request that changes data under /v1 and carries the session cookie must come from the application's
// own origin (BETTER_AUTH_URL), the one Better Auth also trusts for /api/auth. The browser sets Origin on every cross-site POST and
// the page cannot forge it; Sec-Fetch-Site is the fallback when a browser leaves Origin out. Together with the cookie's
// SameSite=Lax, that is what OWASP accepts without a token. A request without a cookie has nothing a forged one could ride on
// (a webhook, an API key, or no session: the tenant middleware answers 401), so it is not checked here.

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** May this request change data for the session it carries? */
export function sameOriginAllowed(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  origin: string,
): boolean {
  if (SAFE.has(req.method ?? 'GET') || req.headers.cookie === undefined) return true;
  const sent = req.headers.origin;
  if (sent !== undefined) return sent === origin;
  return req.headers['sec-fetch-site'] === 'same-origin';
}

/** Express middleware for /v1: 403 forbidden as problem+json, with a fixed detail that does not repeat the origin sent. */
export function createSameOriginCheck(origin: string) {
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
    if (sameOriginAllowed(req, origin)) return next();
    sendProblem(
      res,
      problem(403, 'forbidden', 'This request must come from the application itself.'),
    );
  };
}
