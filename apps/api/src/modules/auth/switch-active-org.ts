import type { createDbPool } from '@gani/db';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

import { mustSetUpTwoFactor, TWO_FACTOR_SETUP_REQUIRED } from './two-factor.js';

// POST /switch-org: the person acts in another organisation they belong to (N85). A session has one active organisation, so
// switching is a NEW session with active_org_id set and the old one revoked, both in one transaction. The person comes from the
// authenticated session, never from the request; the organisation comes from the body and must be an active membership.
type Pool = ReturnType<typeof createDbPool>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER = `SELECT 1 FROM app.memberships_for_user($1) WHERE org_id = $2 AND status = 'active'`;

export function switchActiveOrg(pool: Pool): BetterAuthPlugin {
  return {
    id: 'switch-active-org',
    endpoints: {
      switchActiveOrg: createAuthEndpoint(
        '/switch-org',
        { method: 'POST', use: [sessionMiddleware] },
        async (ctx) => {
          const { session, user } = ctx.context.session;
          // Before anything else, so the answer does not depend on the body: who must set up a second factor does that first.
          if (await mustSetUpTwoFactor(pool, user.id)) {
            throw APIError.from('FORBIDDEN', TWO_FACTOR_SETUP_REQUIRED);
          }
          const asked = (ctx.body as Record<string, unknown> | undefined)?.['orgId'];
          if (typeof asked !== 'string' || !UUID.test(asked)) {
            throw APIError.from('BAD_REQUEST', {
              code: 'INVALID_ORG_ID',
              message: 'orgId must be a UUID',
            });
          }
          const orgId = asked.toLowerCase();
          if ((session as Record<string, unknown>)['activeOrgId'] === orgId)
            return ctx.json({ ok: true });
          // The same answer for "not a member" and "no such organisation": nothing tells which organisations exist.
          const member = await pool.query(MEMBER, [user.id, orgId]);
          if (member.rowCount !== 1) {
            throw APIError.from('NOT_FOUND', {
              code: 'ORG_NOT_FOUND',
              message: 'Organisation not found',
            });
          }
          const created = await ctx.context.adapter.transaction(async (trx) => {
            // 0 rows revoked: a parallel switch already replaced this session. Abort, so only one of two requests wins.
            const revoked = await trx.deleteMany({
              model: 'session',
              where: [{ field: 'token', value: session.token }],
            });
            if (revoked === 0) {
              throw APIError.from('UNAUTHORIZED', {
                code: 'SESSION_CHANGED',
                message: 'Session is no longer valid',
              });
            }
            return ctx.context.internalAdapter.createSession(user.id, false, {
              activeOrgId: orgId,
            });
          });
          await setSessionCookie(ctx, { session: created, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  };
}
