import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { Logger } from '@nestjs/common';

import { errorCode } from '../database/database.service.js';
import { chooseOrganisation, type OrganisationSources } from '../request-context/org-selection.js';
import type { RequestContext } from '../request-context/request-context.js';
import type { SessionResolver } from '../request-context/session-resolver.js';

// The handshake of /agent (realtime spec §2, N94(1)). Socket.IO answers its own path below Express, so the 2FA gate and the tenant
// middleware of /v1 do NOT run for a socket: every step of theirs is done again here, in their order, with the same functions.

/** Who a socket acts for: the RequestContext of HTTP, plus the session it came with and when that was last checked (spec §6). */
export interface AgentContext extends RequestContext {
  readonly sessionId: string;
  readonly checkedAt: number;
}

export type HandshakeCode =
  | 'forbidden_origin'
  | 'unauthorized'
  | 'two_factor_setup_required'
  | 'no_organisation'
  | 'org_not_selected'
  | 'rate_limited'
  | 'service_unavailable';

export interface AuthenticateDeps extends OrganisationSources {
  readonly sessions: Pick<SessionResolver, 'resolve'>;
  mustSetUp(userId: string): Promise<boolean>;
}

/**
 * Steps 2–5 of §2: the session, the 2FA rule, the organisation (the function of the tenant middleware), the member. Also what the
 * periodic check of a live socket runs again (V7c), with a resolver that does not cache. A database that fails throws.
 */
export async function authenticate(
  deps: AuthenticateDeps,
  req: IncomingMessage,
  traceId: string,
  now: number,
): Promise<{ readonly ctx: AgentContext } | { readonly refused: HandshakeCode }> {
  const session = await deps.sessions.resolve(req);
  if (!session) return { refused: 'unauthorized' };
  if (await deps.mustSetUp(session.userId)) return { refused: 'two_factor_setup_required' };
  const choice = await chooseOrganisation(deps, session);
  if ('refused' in choice) return choice;
  const ctx: AgentContext = {
    userId: session.userId,
    orgId: choice.orgId,
    role: choice.member.role,
    workspaceIds: Object.freeze([...choice.member.workspaceIds]),
    resolvedAt: session.resolvedAt,
    traceId,
    sessionId: session.sessionId,
    checkedAt: now,
  };
  return { ctx: Object.freeze(ctx) };
}

export interface HandshakeDeps extends AuthenticateDeps {
  /** The application's origin (BETTER_AUTH_URL): any other Origin is refused, so another site cannot ride on the cookie. */
  readonly origin: string;
  /** Sockets this person already has on this instance (spec §7: at most `maxPerUser`). */
  connections(userId: string): Promise<number>;
  readonly maxPerUser: number;
  readonly log: Pick<Logger, 'warn'>;
  readonly now?: () => number;
}

/** The error a refused handshake gives the client as `connect_error`: a code and a traceId, never the cause. */
export class HandshakeRefusedError extends Error {
  readonly data: { readonly code: HandshakeCode; readonly traceId: string };
  constructor(code: HandshakeCode, traceId: string) {
    super(code);
    this.name = 'HandshakeRefusedError';
    this.data = { code, traceId };
  }
}

interface HandshakeSocket {
  readonly id: string;
  readonly request: IncomingMessage;
  data: { ctx?: AgentContext };
}

/** The middleware of the namespace. What the client puts in `auth` or `query` is never read: the tenant is the server's decision. */
export function createAgentHandshake(deps: HandshakeDeps) {
  const now = deps.now ?? Date.now;
  return (socket: HandshakeSocket, next: (error?: Error) => void): void => {
    const traceId = randomUUID();
    const refuse = (code: HandshakeCode, cause = '') => {
      deps.log.warn(`socket refused (${code}${cause}) socket=${socket.id} trace=${traceId}`);
      next(new HandshakeRefusedError(code, traceId));
    };
    if (socket.request.headers.origin !== deps.origin) return refuse('forbidden_origin');
    const run = async (): Promise<void> => {
      const result = await authenticate(deps, socket.request, traceId, now());
      if ('refused' in result) return refuse(result.refused);
      if ((await deps.connections(result.ctx.userId)) >= deps.maxPerUser)
        return refuse('rate_limited');
      socket.data.ctx = result.ctx;
      next();
    };
    run().catch((error: unknown) =>
      refuse('service_unavailable', `: ${error instanceof Error ? errorCode(error) : 'unknown'}`),
    );
  };
}
