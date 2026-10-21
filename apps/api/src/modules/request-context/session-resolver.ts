import type { IncomingMessage } from 'node:http';

import { fromNodeHeaders } from 'better-auth/node';

export interface ResolvedSession {
  readonly userId: string;
  readonly sessionId: string;
  /** `sessions.active_org_id`; `null` until the person has chosen one. */
  readonly activeOrgId: string | null;
  readonly resolvedAt: Date;
}

/** The part of `auth.api.getSession` this class needs, so it can be tested without Better Auth. */
export interface SessionSource {
  api: {
    getSession(options: {
      headers: Headers;
    }): Promise<{ session: { id: string }; user: { id: string } } | null>;
  };
}

/**
 * Looks up the session of a request ONCE. Every layer that needs it (the 2FA gate, the tenant middleware, a guard) calls
 * `resolve(req)` and shares the answer, keyed by the request object itself: the entry cannot outlive the request and cannot
 * be reached from another one. Concurrent callers share the same lookup. A failed lookup is not remembered.
 */
export class SessionResolver {
  private readonly cache = new WeakMap<object, Promise<ResolvedSession | null>>();

  constructor(private readonly source: SessionSource) {}

  resolve(req: IncomingMessage): Promise<ResolvedSession | null> {
    const cached = this.cache.get(req);
    if (cached) return cached;
    const lookup = this.lookup(req);
    this.cache.set(req, lookup);
    lookup.catch(() => this.cache.delete(req));
    return lookup;
  }

  /**
   * Looks the session up again, past the cache: for a socket, whose request object lives as long as the connection, so that the cache
   * of `resolve` would answer for ever and never see a session that was revoked (realtime spec §6, N94(2)).
   */
  resolveFresh(req: IncomingMessage): Promise<ResolvedSession | null> {
    return this.lookup(req);
  }

  private async lookup(req: IncomingMessage): Promise<ResolvedSession | null> {
    const found = await this.source.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!found) return null;
    const active = (found.session as Record<string, unknown>)['activeOrgId'];
    return {
      userId: found.user.id,
      sessionId: found.session.id,
      activeOrgId: typeof active === 'string' ? active : null,
      resolvedAt: new Date(),
    };
  }
}
