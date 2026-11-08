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
import { runWithRequestContext, type OperatorRequestContext } from './request-context.js';
import type { ResolvedSession, SessionResolver } from './session-resolver.js';

// The routes under /v1 that work without an organisation: what to do next (2FA set-up, 6d-3) and who is signed in (U32, which
// answers `org: null` itself). Compared as exact lower-case paths, so any other spelling is NOT exempt and goes through the
// middleware (fails closed).
const EXEMPT_PATHS = new Set(['/v1/me/security-status', '/v1/me']);

export interface TenantMiddlewareDeps extends OrganisationSources {
  sessions: Pick<SessionResolver, 'resolve'>;
  /** `users.is_platform_operator` of the caller (auth pool); false for a deleted person. */
  isPlatformOperator(userId: string): Promise<boolean>;
  /** `app.access_session_org` (ADR-004 no. 20): the organisation of the caller's live access session, or null. */
  accessSessionOrg(sessionId: string, operatorId: string): Promise<string | null>;
}

const ACCESS_SESSION_HEADER = 'x-access-session-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// N207 B1: the only writes of an operator in a session. Exact, on the lower-case path as written: no other spelling passes.
const OPERATOR_WRITES: readonly (readonly [string, RegExp])[] = [
  ['POST', /^\/v1\/security-incidents$/],
  [
    'PATCH',
    /^\/v1\/security-incidents\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ],
];
const READS = new Set(['GET', 'HEAD']);
const ACCESS_SESSION_REFUSALS = {
  not_platform_operator: 'Only a platform operator can use an access session.',
  access_session_expired: 'The access session has ended. Open a new one from /platform.',
  forbidden: 'An access session opens reading only.',
} as const;

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
 * is a 403; a database that fails is a 503 with no cause in the body: the two must never look alike. `next()` runs inside the context,
 * so everything after sees it.
 *
 * With `X-Access-Session-Id` (U79, N207, P11b-1) the request is a platform operator's, or refused: never served as a member. The 2FA
 * gate has run before. Not an operator: 403 not_platform_operator; no live session of the caller: 403 access_session_expired; a write
 * other than the two of N207 B1: 403 forbidden. Otherwise an OperatorRequestContext with the session's organisation, no tenant context.
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
    if ('operator' in decided) {
      const operator = { ...decided.operator, traceId };
      return runWithRequestContext(operator, () => next());
    }
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
  | { operator: Omit<OperatorRequestContext, 'traceId'> }
  | { refusal: ReturnType<typeof problem> };

const cause = (error: unknown): string => (error instanceof Error ? errorCode(error) : 'unknown');

async function decide(deps: TenantMiddlewareDeps, req: Req, traceId: string): Promise<Decision> {
  const refuse = (status: number, code: string, detail: string): Decision => ({
    refusal: problem(status, code, detail, traceId),
  });
  const session = await deps.sessions.resolve(req);
  if (!session) return refuse(401, 'unauthorized', 'Sign in first.');
  const header = req.headers[ACCESS_SESSION_HEADER];
  if (header !== undefined) {
    const refused = (code: keyof typeof ACCESS_SESSION_REFUSALS): Decision => {
      logger.log(`access session refused (${code}) user=${session.userId} trace=${traceId}`);
      return refuse(403, code, ACCESS_SESSION_REFUSALS[code]);
    };
    // A member who sends the header is refused, never served as a member (CEO 08/11 §4); the reason differs from an expired session.
    if (!(await deps.isPlatformOperator(session.userId))) return refused('not_platform_operator');
    const id = typeof header === 'string' ? header.toLowerCase() : '';
    const orgId = UUID.test(id) ? await deps.accessSessionOrg(id, session.userId) : null;
    if (!orgId) return refused('access_session_expired');
    const method = req.method ?? '';
    const path = pathOf(req);
    if (!READS.has(method) && !OPERATOR_WRITES.some(([m, p]) => m === method && p.test(path)))
      return refused('forbidden');
    const { userId, resolvedAt } = session;
    return {
      operator: {
        role: 'platform_operator',
        userId,
        orgId,
        accessSessionId: id,
        workspaceIds: [],
        resolvedAt,
      },
    };
  }
  const choice = await chooseOrganisation(deps, session);
  if ('refused' in choice)
    return refuse(403, choice.refused, ORGANISATION_REFUSALS[choice.refused]);
  return { session, ...choice };
}
