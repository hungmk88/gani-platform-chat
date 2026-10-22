import { createHash } from 'node:crypto';

import {
  acceptInvite,
  acceptInviteWithPassword,
  InvalidInviteError,
  lookupInvite,
  type createDbPool,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

import { TokenBuckets } from '../hooks/token-bucket.js';
import { hashPassword, isStrongPassword } from './password.js';

// The invitation of a person (DB-02b, N151, spec RLS M01 §3.7, prototype #4), as two routes of Better Auth next to sign-in:
// - POST /invite/lookup { token }: what the invitation is for (the email and the role), so the page can say it;
// - POST /invite/accept { token, password, name? }: a person not signed in takes the invitation, their password and a session in one
//   step (acceptInviteWithPassword: one transaction, then a session); a signed-in person whose email it is takes it as they are.
// Every refusal of a token is one answer (404 INVITE_INVALID, the same text), whatever its reason: nobody learns whether a token or an
// email exists. Both routes need the Origin of the application (N136, even without a cookie: the link is followed in a browser) and are
// limited per token (10 a minute, the key is its SHA-256: never the token) besides the limiter of Better Auth per address (60 a minute).

type Pool = ReturnType<typeof createDbPool>;
const INVALID = { code: 'INVITE_INVALID', message: 'Link không hợp lệ hoặc đã hết hạn.' };
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
export const INVITE_PATHS = ['/invite/lookup', '/invite/accept'] as const;

const body = (ctx: { body?: unknown }): Record<string, unknown> =>
  typeof ctx.body === 'object' && ctx.body !== null ? (ctx.body as Record<string, unknown>) : {};

export function invitations(
  pool: Pool,
  origin: string,
  perToken = new TokenBuckets({ perSecond: 10 / 60, burst: 10 }),
): BetterAuthPlugin {
  /** The checks every call passes first: the Origin of the application, a token that looks like one, and its own rate. */
  const admit = (ctx: { request?: Request | undefined; body?: unknown }): string => {
    if (ctx.request && ctx.request.headers.get('origin') !== origin)
      throw APIError.from('FORBIDDEN', { code: 'FORBIDDEN_ORIGIN', message: 'Forbidden' });
    const token = body(ctx)['token'];
    if (typeof token !== 'string' || !TOKEN.test(token)) throw APIError.from('NOT_FOUND', INVALID);
    const key = createHash('sha256').update(token, 'utf8').digest('hex');
    if (!perToken.take(key, Date.now()))
      throw APIError.from('TOO_MANY_REQUESTS', {
        code: 'RATE_LIMITED',
        message: 'Too many attempts',
      });
    return token;
  };

  return {
    id: 'invitations',
    endpoints: {
      lookupInvite: createAuthEndpoint('/invite/lookup', { method: 'POST' }, async (ctx) => {
        const invite = await lookupInvite(pool, admit(ctx));
        if (!invite) throw APIError.from('NOT_FOUND', INVALID);
        return ctx.json({ invitedEmail: invite.invitedEmail, role: invite.role });
      }),
      acceptInvite: createAuthEndpoint('/invite/accept', { method: 'POST' }, async (ctx) => {
        const token = admit(ctx);
        const signedIn = await getSessionFromCtx(ctx);
        try {
          if (signedIn) {
            const accepted = await acceptInvite(pool, token, uuidv7(), signedIn.user.id);
            return ctx.json({ orgId: accepted.orgId, role: accepted.role });
          }
          const password = body(ctx)['password'];
          // ADR-003, checked before the token is used: a weak password leaves the invitation as it was.
          if (typeof password !== 'string' || !isStrongPassword(password))
            throw APIError.from('BAD_REQUEST', {
              code: 'PASSWORD_TOO_WEAK',
              message: 'At least 12 characters, with a letter and a digit',
            });
          const name = body(ctx)['name'];
          const accepted = await acceptInviteWithPassword(pool, token, uuidv7(), {
            passwordHash: await hashPassword(password),
            accountId: uuidv7(),
            ...(typeof name === 'string' ? { displayName: name.slice(0, 120) } : {}),
          });
          const user = await ctx.context.internalAdapter.findUserById(accepted.userId);
          if (!user) throw APIError.from('NOT_FOUND', INVALID);
          // The new session acts in the organisation that invited them (N85).
          const session = await ctx.context.internalAdapter.createSession(user.id, false, {
            activeOrgId: accepted.orgId,
          });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ orgId: accepted.orgId, role: accepted.role });
        } catch (error) {
          if (error instanceof InvalidInviteError) throw APIError.from('NOT_FOUND', INVALID);
          throw error;
        }
      }),
    },
  };
}
