import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { runWithTenantContext, type MemberContext } from '@gani/db';
import { Logger } from '@nestjs/common';

import { errorCode } from '../database/database.service.js';
import { problem, sendProblem } from './problem.js';
import { runWithRequestContext } from './request-context.js';
import type { ResolvedSession, SessionResolver } from './session-resolver.js';

// The one route under /v1 that works without an organisation: the client asks it what to do next (2FA set-up, 6d-3). Compared as
// an exact lower-case path, so any other spelling of it is NOT exempt and goes through the middleware (fails closed).
const EXEMPT_PATH = '/v1/me/security-status';

export interface TenantMiddlewareDeps {
  sessions: Pick<SessionResolver, 'resolve'>;
  /** Organisations in which the person is an active member (auth pool: no tenant context exists yet). */
  organisations(userId: string): Promise<readonly string[]>;
  /** Role and workspaces in `orgId`, or `null` when the person is not an active member of it. Throws when the database fails. */
  member(orgId: string, userId: string): Promise<MemberContext | null>;
}

type Req = IncomingMessage & { originalUrl?: string };
type Next = (error?: unknown) => void;

const logger = new Logger('TenantContext');
// The path as written, without the query: NOT normalised (new URL would turn /v1/x/../me/security-status into the exempt path).
const pathOf = (req: Req): string =>
  (req.originalUrl ?? req.url ?? '/').split(/[?#]/, 1)[0]?.toLowerCase() ?? '';

/**
 * Gives every /v1 request its RequestContext (N90, N91, N92). The organisation comes from the SESSION and the database, never from
 * the request: a path, query, header or body that names another organisation changes nothing here, and a person reaching for another
 * tenant's row gets a 404 from the handler when row-level security returns nothing (S2), not from this middleware.
 *
 * Organisation: the one the session has chosen, if the person is still an active member; otherwise the only active one; several is
 * 403 ORG_NOT_SELECTED and none is 403 NO_ORGANISATION. "Not a member" (a null answer) is a 403; a database that fails is a 503 with
 * no cause in the body: the two must never look alike. `next()` runs inside the context, so everything after sees it.
 */
export function createTenantContextMiddleware(deps: TenantMiddlewareDeps) {
  return async (req: Req, res: ServerResponse, next: Next): Promise<void> => {
    if (pathOf(req) === EXEMPT_PATH) return next();
    const traceId = randomUUID();
    let decided: Decision;
    try {
      decided = await decide(deps, req, traceId);
    } catch (error) {
      logger.warn(`tenant context failed (${cause(error)}) trace=${traceId}`);
      const detail = 'The service cannot answer right now. Try again.';
      return sendProblem(res, problem(503, 'SERVICE_UNAVAILABLE', detail, traceId));
    }
    if ('refusal' in decided) return sendProblem(res, decided.refusal);
    const { session, orgId, member } = decided;
    const ctx = { userId: session.userId, orgId, ...member, resolvedAt: session.resolvedAt };
    runWithRequestContext(ctx, () => runWithTenantContext(ctx, () => next()));
  };
}

type Decision =
  | { session: ResolvedSession; orgId: string; member: MemberContext }
  | { refusal: ReturnType<typeof problem> };

const cause = (error: unknown): string => (error instanceof Error ? errorCode(error) : 'unknown');

async function decide(deps: TenantMiddlewareDeps, req: Req, traceId: string): Promise<Decision> {
  const refuse = (status: number, code: string, detail: string): Decision => ({
    refusal: problem(status, code, detail, traceId),
  });
  const session = await deps.sessions.resolve(req);
  if (!session) return refuse(401, 'UNAUTHENTICATED', 'Sign in first.');
  if (session.activeOrgId) {
    const member = await deps.member(session.activeOrgId, session.userId);
    if (member) return { session, orgId: session.activeOrgId, member };
  }
  const orgs = await deps.organisations(session.userId);
  const [only, ...others] = orgs;
  if (only === undefined)
    return refuse(403, 'NO_ORGANISATION', 'You are not a member of any organisation.');
  if (others.length > 0) return refuse(403, 'ORG_NOT_SELECTED', 'Choose an organisation first.');
  const member = await deps.member(only, session.userId);
  if (!member) return refuse(403, 'NO_ORGANISATION', 'You are not a member of any organisation.');
  return { session, orgId: only, member };
}
