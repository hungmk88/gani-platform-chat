import { authSchema, createAuthDb, type createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import type { AdapterFactory } from 'better-auth/adapters';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';

import type { AuthEnv } from './auth.env.js';
import { loginLockout, WRONG_CREDENTIALS, type LoginLockout } from './login-lockout.js';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from './password.js';
import { revokingAdapter } from './revoking-adapter.js';
import { MAX_SESSION_MS, sessionCreateBefore } from './session-hooks.js';
import { switchActiveOrg } from './switch-active-org.js';

// The whole configuration of Better Auth in one place (ADR-003, N79, N81, N82, N83). It takes the checked environment, never process.env.
// Routes that make or change a user are shut: users come from app.accept_invite and the trigger on users, and nothing here sends
// email. /sign-up/email needs both settings (disableSignUp also stops server-side calls, disabledPaths gives the 404).
// /two-factor/disable is listed ahead of the plugin (PR6c-3): a 2FA enrolment is not removed by this library (auth_role has no DELETE).
const DISABLED_PATHS = [
  '/sign-up/email',
  '/verify-email',
  '/update-user',
  '/update-session',
  '/send-verification-email',
  '/two-factor/disable',
  // No sender is configured for one-time codes by message: TOTP and backup codes are the only second factors.
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
  // Password reset by token is not used: users set their password through our own flow (PR7), and /reset-password makes an account
  // when there is none. A parametrised path such as /reset-password/:token cannot be listed here (the library compares the real path),
  // so that route is closed in the hook below.
  '/reset-password',
  '/request-password-reset',
];
const SIGN_IN = '/sign-in/email';
// Where the rate limiter reads the address of the caller (review C-01, N112 pending the deployment topology). This is the default of the
// library, written down so that the decision is visible and changing it is a diff. Known and pinned by auth.rate-limit-ip.test.ts: a
// request with no such header, or with a chain "a, b", has no trusted address and shares ONE bucket per path; a single value is taken
// as it comes, so a caller who reaches the API directly can pick it. `advanced.ipAddress.trustedProxies` is the other half of N112.
// Waiting for N112 / topology: do not set `trustedProxies` or change the header before the proxy in front of the API is known.
const IP_ADDRESS_HEADERS: string[] = ['x-forwarded-for'];

type Database = AdapterFactory<BetterAuthOptions>;

const omitToken = (object: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'token'));

/**
 * Review SEC-03: the session token is the cookie's business (HttpOnly, signed), not JavaScript's. A body that holds it (sign-in, the 2FA
 * steps: `token`; get-session: `session.token`) is answered without it; `undefined` leaves the answer as it is. /list-sessions keeps its
 * tokens (an array, untouched): /revoke-session needs them.
 */
export function withoutSessionToken(returned: unknown): Record<string, unknown> | undefined {
  if (typeof returned !== 'object' || returned === null || Array.isArray(returned))
    return undefined;
  if (isAPIError(returned) || returned instanceof Response) return undefined;
  const body = returned as Record<string, unknown>;
  const session = body['session'];
  const nested = typeof session === 'object' && session !== null && 'token' in session;
  if (!('token' in body) && !nested) return undefined;
  const rest = omitToken(body);
  return nested ? { ...rest, session: omitToken(session) } : rest;
}

/** `lockout` and `plugins` need the database (createAuth); without them buildAuthOptions is the pure part, which the unit tests use. */
export function buildAuthOptions(
  env: AuthEnv,
  database: Database,
  extras: { lockout?: LoginLockout; plugins?: BetterAuthPlugin[] } = {},
) {
  return {
    baseURL: env.baseURL,
    // With a version, what the 2FA plugin encrypts (secret, backup codes) carries it, so a key can be replaced without re-encrypting at
    // once; replacing it signs everyone out (cookies are signed with the current key only) and the old one must stay until the
    // enrolments are re-encrypted (N86, N88).
    secrets: [{ version: 1, value: env.secret }],
    trustedOrigins: [env.baseURL],
    database,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    // 12 hours, never extended: expires_at cannot be updated by auth_role. revokedAt and activeOrgId are columns of ours that the
    // revoking adapter and the session switch need Better Auth to know.
    session: {
      expiresIn: MAX_SESSION_MS / 1000,
      disableSessionRefresh: true,
      additionalFields: {
        revokedAt: { type: 'date', required: false, input: false },
        activeOrgId: { type: 'string', required: false, input: false },
      },
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      // Secure and the __Secure- prefix follow the address: loadAuthEnv allows http only on a developer machine.
      useSecureCookies: env.secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS },
    },
    databaseHooks: { session: { create: { before: sessionCreateBefore() } } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Only over HTTP: a call from our own server code has no request.
        if (ctx.request && ctx.path === '/reset-password/:token') {
          throw APIError.from('NOT_FOUND', { code: 'NOT_FOUND', message: 'Not Found' });
        }
        if (ctx.path === SIGN_IN && (await extras.lockout?.isLocked(ctx.body)) === true) {
          throw APIError.from('UNAUTHORIZED', WRONG_CREDENTIALS);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        if (ctx.path === SIGN_IN && extras.lockout) {
          if (isAPIError(returned)) {
            if (returned.body?.code === WRONG_CREDENTIALS.code)
              await extras.lockout.failed(ctx.body);
          } else if (ctx.context.newSession) await extras.lockout.succeeded(ctx.body);
        }
        // Only over HTTP: our own server code (getSession of the SessionResolver) keeps the whole answer.
        return ctx.request ? withoutSessionToken(returned) : undefined;
      }),
    },
    plugins: [
      twoFactor({
        issuer: 'Gani',
        // 5 wrong codes in a row lock the enrolment for 30 minutes, kept in two_factors; the lock of the account (users) is separate.
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 1800 },
        // 0 turns "trust this device" off. Left alone, a client that sends trustDevice: true gets a cookie that skips the second
        // factor for 30 days (measured): a way round the rule that Owner, Admin and platform operators use 2FA.
        trustDeviceMaxAge: 0,
      }),
      ...(extras.plugins ?? []),
    ],
    disabledPaths: DISABLED_PATHS,
    // Explicit: the library enables its limiter only in production. In memory, so exact for one instance only (N79).
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
    },
    // A one-time token is marked used_at, never deleted, and the library's habit of deleting expired rows on every read is switched
    // off: cleaning is a job of migration_role (N87). usedAt is our column; the revoking adapter needs the library to know it.
    verification: {
      disableCleanup: true,
      additionalFields: { usedAt: { type: 'date', required: false, input: false } },
    },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

/** Better Auth on PostgreSQL as auth_role: `pool` is the pool of DATABASE_URL_AUTH, `env` comes from loadAuthEnv. */
export function createAuth(args: { pool: ReturnType<typeof createDbPool>; env: AuthEnv }) {
  const adapter = drizzleAdapter(createAuthDb(args.pool), {
    provider: 'pg',
    schema: authSchema,
    usePlural: true,
  });
  return betterAuth(
    buildAuthOptions(args.env, revokingAdapter(adapter), {
      lockout: loginLockout(args.pool),
      plugins: [switchActiveOrg(args.pool)],
    }),
  );
}
