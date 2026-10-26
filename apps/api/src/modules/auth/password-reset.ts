import { createHash, randomBytes } from 'node:crypto';

import {
  issuePasswordReset,
  PASSWORD_RESET_MINUTES,
  resetPassword,
  type createDbPool,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { EmailSendError, type EmailSender } from '@gani/email';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';

import { TokenBuckets } from '../hooks/token-bucket.js';
import { authLogger } from './auth-logger.js';
import { hashPassword, isStrongPassword } from './password.js';
import { storeErrorCode } from './safe-errors-adapter.js';

// "Quên mật khẩu" (PR7, N84, N162), two routes of Better Auth next to sign-in, for a person who is not signed in:
// - POST /password/forgot { email }: always 202, whether the email is a person's or not. The link is made and sent AFTER the answer,
//   so neither the answer nor its time says whether the address exists; one address gets at most 3 links in 15 minutes (silently).
// - POST /password/reset { token, password }: a strong password for the link's person (resetPassword: one transaction that also ends
//   every session, lifts the lock and is audited). Every refusal of a token is one answer (404 RESET_INVALID, the same text). No session
//   is made: the person signs in again, with their second factor.
// Both need the Origin of the application (N136, the link is followed in a browser) and have the limiter of Better Auth per address;
// /password/reset is also limited per token (10 a minute, the key is its SHA-256: never the token). Nothing logs an address or a token.

type Pool = ReturnType<typeof createDbPool>;
const INVALID = { code: 'RESET_INVALID', message: 'Link không hợp lệ hoặc đã hết hạn.' };
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
export const PASSWORD_RESET_PATHS = ['/password/forgot', '/password/reset'] as const;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The email with the link; the token is in the fragment (#), which no server receives in a request line or its logs. */
export function passwordResetMessage(origin: string, to: string, token: string) {
  return {
    to,
    subject: 'Đặt lại mật khẩu Gani',
    text: [
      'Có yêu cầu đặt lại mật khẩu cho tài khoản Gani của bạn.',
      '',
      `Đặt mật khẩu mới: ${origin}/reset-password#token=${token}`,
      '',
      `Liên kết dùng được một lần và hết hạn sau ${PASSWORD_RESET_MINUTES} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này: mật khẩu cũ vẫn dùng được.`,
    ].join('\n'),
  };
}

export interface PasswordResetDeps {
  readonly pool: Pool;
  readonly origin: string;
  readonly sender: EmailSender;
  /** Runs the work of /password/forgot after the answer; tests pass one that keeps the promise. */
  readonly later?: (job: () => Promise<void>) => void;
  readonly perEmail?: TokenBuckets;
  readonly perToken?: TokenBuckets;
}

export function passwordReset(deps: PasswordResetDeps): BetterAuthPlugin {
  const later = deps.later ?? ((job) => void job());
  const perEmail = deps.perEmail ?? new TokenBuckets({ perSecond: 3 / 900, burst: 3 });
  const perToken = deps.perToken ?? new TokenBuckets({ perSecond: 10 / 60, burst: 10 });
  const field = (ctx: { body?: unknown }, name: string): unknown =>
    typeof ctx.body === 'object' && ctx.body !== null
      ? (ctx.body as Record<string, unknown>)[name]
      : undefined;
  const fromApp = (ctx: { request?: Request | undefined }) => {
    if (ctx.request && ctx.request.headers.get('origin') !== deps.origin)
      throw APIError.from('FORBIDDEN', { code: 'FORBIDDEN_ORIGIN', message: 'Forbidden' });
  };

  /** Makes and sends a link, or does nothing; never throws, logs codes only. */
  const sendLink = async (email: string): Promise<void> => {
    if (!perEmail.take(sha256(email), Date.now())) return;
    const token = randomBytes(32).toString('base64url');
    try {
      const person = await issuePasswordReset(deps.pool, { email, token, id: uuidv7() });
      if (person) await deps.sender.send(passwordResetMessage(deps.origin, email, token));
    } catch (error) {
      const code = error instanceof EmailSendError ? error.code : storeErrorCode(error);
      authLogger.warn(`password reset link not sent (${code})`);
    }
  };

  return {
    id: 'password-reset',
    endpoints: {
      forgotPassword: createAuthEndpoint('/password/forgot', { method: 'POST' }, async (ctx) => {
        fromApp(ctx);
        const raw = field(ctx, 'email');
        const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (!EMAIL.test(email))
          throw APIError.from('BAD_REQUEST', { code: 'INVALID_EMAIL', message: 'Invalid email' });
        later(() => sendLink(email));
        ctx.setStatus(202);
        return ctx.json({ accepted: true });
      }),
      resetPassword: createAuthEndpoint('/password/reset', { method: 'POST' }, async (ctx) => {
        fromApp(ctx);
        const token = field(ctx, 'token');
        if (typeof token !== 'string' || !TOKEN.test(token))
          throw APIError.from('NOT_FOUND', INVALID);
        if (!perToken.take(sha256(token), Date.now()))
          throw APIError.from('TOO_MANY_REQUESTS', {
            code: 'RATE_LIMITED',
            message: 'Too many attempts',
          });
        const password = field(ctx, 'password');
        // ADR-003, checked before the token is spent: a weak password leaves the link as it was.
        if (typeof password !== 'string' || !isStrongPassword(password))
          throw APIError.from('BAD_REQUEST', {
            code: 'PASSWORD_TOO_WEAK',
            message: 'At least 12 characters, with a letter and a digit',
          });
        const done = await resetPassword(deps.pool, {
          token,
          passwordHash: await hashPassword(password),
          newId: uuidv7,
        });
        if (!done) throw APIError.from('NOT_FOUND', INVALID);
        return ctx.json({ reset: true });
      }),
    },
  };
}
