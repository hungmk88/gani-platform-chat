import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { posix } from 'node:path';

import { Logger } from '@nestjs/common';

import { isSetupRoute, TWO_FACTOR_SETUP_REQUIRED } from '../auth/two-factor.js';
import { errorCode } from '../database/database.service.js';
import { problem, sendProblem } from './problem.js';
import type { SessionResolver } from './session-resolver.js';

// The prefix Better Auth is mounted at, and the one route of ours that is open to a person who has to set up a second factor.
const AUTH_PREFIX = '/api/auth/';
const STATUS_PATH = '/v1/me/security-status';
// Left alone so a probe or a load balancer never depends on a session or a database.
const OPEN_PATHS = new Set(['/healthz', '/readyz']);

export interface TwoFactorGateDeps {
  sessions: Pick<SessionResolver, 'resolve'>;
  /** `mustSetUpTwoFactor` of the auth pool: required for this person and not yet enabled. */
  mustSetUp(userId: string): Promise<boolean>;
}

type Req = IncomingMessage & { originalUrl?: string };
type Next = (error?: unknown) => void;

const logger = new Logger('TwoFactorGate');

/** The path as written without the query, then normalised the way Better Auth's router normalises it (`.` and `..` segments). */
export function normalisedPath(req: Req): string {
  const raw = (req.originalUrl ?? req.url ?? '/').split(/[?#]/, 1)[0] ?? '';
  return posix.normalize(raw);
}

/**
 * Is this request one a person who has not yet set up their second factor may make? (N86, N93.) Decided on the NORMALISED path and by
 * EXACT equality, never `startsWith`/`includes` for the list: `/api/auth/two-factor/enable/../../list-sessions` normalises to
 * `/api/auth/list-sessions` and is refused, `/api/auth/./two-factor/enable` normalises to the route and is allowed. Under /api/auth the
 * routes are case-sensitive (Better Auth answers 404 to any other case); under /v1 the router ignores case, so that path is compared
 * lower-case.
 */
export function isOpenToUnfinishedSetup(req: Req): boolean {
  const path = normalisedPath(req);
  if (path.startsWith(AUTH_PREFIX)) return isSetupRoute(path.slice(AUTH_PREFIX.length - 1));
  return path.toLowerCase() === STATUS_PATH;
}

/**
 * The 2FA rule for every HTTP request, at the edge, BEFORE Better Auth and before anything of ours: a person with a session who must
 * set up a second factor and has not can only reach TWO_FACTOR_SETUP_ROUTES (under /api/auth) and /v1/me/security-status; everything
 * else is 403 TWO_FACTOR_SETUP_REQUIRED. Without a session the request passes (signing in, and the tenant middleware's 401 after).
 * Every path not named above is closed to such a person, so a new route is closed by default. If the session or the rule cannot be
 * read the request is refused with 503: an unknown answer never lets a request through.
 */
export function createTwoFactorGate(deps: TwoFactorGateDeps) {
  return async (req: Req, res: ServerResponse, next: Next): Promise<void> => {
    if (OPEN_PATHS.has(normalisedPath(req).toLowerCase())) return next();
    const traceId = randomUUID();
    let blocked: boolean;
    try {
      const session = await deps.sessions.resolve(req);
      blocked =
        !!session && (await deps.mustSetUp(session.userId)) && !isOpenToUnfinishedSetup(req);
    } catch (error) {
      const cause = error instanceof Error ? errorCode(error) : 'unknown';
      logger.warn(`two-factor gate failed (${cause}) trace=${traceId}`);
      const detail = 'The service cannot answer right now. Try again.';
      return sendProblem(res, problem(503, 'SERVICE_UNAVAILABLE', detail, traceId));
    }
    if (blocked) {
      const { code, message } = TWO_FACTOR_SETUP_REQUIRED;
      return sendProblem(res, problem(403, code, message, traceId));
    }
    next();
  };
}
