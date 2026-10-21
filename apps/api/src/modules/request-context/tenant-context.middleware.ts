import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { runWithTenantContext, type MemberContext } from '@gani/db';
import { Logger } from '@nestjs/common';

import { errorCode } from '../database/database.service.js';
import {
  chooseOrganisation,
  ORGANISATION_REFUSALS,
  type OrganisationSources,
} from './org-selection.js';
import { problem, sendProblem } from './problem.js';
import { runWithRequestContext } from './request-context.js';
import type { ResolvedSession, SessionResolver } from './session-resolver.js';

// The routes under /v1 that work without an organisation: what to do next (2FA set-up, 6d-3) and who is signed in (U32, which
// answers `org: null` itself). Compared as exact lower-case paths, so any other spelling is NOT exempt and goes through the
// middleware (fails closed).
const EXEMPT_PATHS = new Set(['/v1/me/security-status', '/v1/me']);

export interface TenantMiddlewareDeps extends OrganisationSources {
  sessions: Pick<SessionResolver, 'resolve'>;
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
 * Organisation: `chooseOrganisation` (shared with the handshake of the socket); its refusals are 403s. "Not a member" (a null answer)
 * is a 403; a database that fails is a 503 with no cause in the body: the two must never look alike. `next()` runs inside the context, so everything after sees it.
 */
export function createTenantContextMiddleware(deps: TenantMiddlewareDeps) {
  return async (req: Req, res: ServerResponse, next: Next): Promise<void> => {
    if (EXEMPT_PATHS.has(pathOf(req))) return next();
    const traceId = randomUUID();
    let decided: Decision;
    try {
      decided = await decide(deps, req, traceId);
    } catch (error) {
      logger.warn(`tenant context failed (${cause(error)}) trace=${traceId}`);
      const detail = 'The service cannot answer right now. Try again.';
      return sendProblem(res, problem(503, 'service_unavailable', detail, traceId));
    }
    if ('refusal' in decided) return sendProblem(res, decided.refusal);
    const { session, orgId, member } = decided;
    const ctx = {
      userId: session.userId,
      orgId,
      ...member,
      resolvedAt: session.resolvedAt,
      traceId,
    };
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
  if (!session) return refuse(401, 'unauthorized', 'Sign in first.');
  const choice = await chooseOrganisation(deps, session);
  if ('refused' in choice)
    return refuse(403, choice.refused, ORGANISATION_REFUSALS[choice.refused]);
  return { session, ...choice };
}
