import { authSchema, createAuthDb, type createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { AdapterFactory } from 'better-auth/adapters';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { AuthEnv } from './auth.env.js';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from './password.js';
import { revokingAdapter } from './revoking-adapter.js';
import { MAX_SESSION_MS, sessionCreateBefore } from './session-hooks.js';

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
];

type Database = AdapterFactory<BetterAuthOptions>;

export function buildAuthOptions(env: AuthEnv, database: Database) {
  return {
    baseURL: env.baseURL,
    secret: env.secret,
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
    },
    databaseHooks: { session: { create: { before: sessionCreateBefore() } } },
    disabledPaths: DISABLED_PATHS,
    // Explicit: the library enables its limiter only in production. In memory, so exact for one instance only (N79).
    rateLimit: {
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
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
  return betterAuth(buildAuthOptions(args.env, revokingAdapter(adapter)));
}
