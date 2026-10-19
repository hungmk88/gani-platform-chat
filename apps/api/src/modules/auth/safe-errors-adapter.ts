import type { createDbPool } from '@gani/db';
import type { BetterAuthOptions } from 'better-auth';
import { isAPIError } from 'better-auth/api';
import type { AdapterFactory, DBAdapter } from 'better-auth/adapters';

// Review SEC-01: a failed query of the Drizzle adapter is a DrizzleQueryError whose message holds the SQL and its parameters (an email,
// a session token), and Better Auth prints it in three places (its onError, its logger, and better-call's console.error), whatever the
// logger is set to. So the error is cleaned where it starts: every call of the adapter that fails with anything but an APIError throws
// an AuthStoreError that carries only a code (SQLSTATE, or a system code such as ECONNREFUSED). No cause is kept: Node prints a cause
// in full. An APIError (a decision of Better Auth or of our code, such as SESSION_CHANGED inside a transaction) goes through untouched.

/** A failure of the auth database, reduced to its code. */
export class AuthStoreError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`auth store failed (${code})`);
    this.name = 'AuthStoreError';
    this.code = code;
  }
}

const CODE = /^[A-Z0-9_]{1,32}$/;

/** The SQLSTATE or system code of a driver error, looked for on the error and on its cause; never its message. */
export function storeErrorCode(error: unknown): string {
  for (let e = error, depth = 0; typeof e === 'object' && e !== null && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && CODE.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return 'unknown';
}

/** The error to throw instead of `error`: itself when it is an APIError or already clean, a code-only AuthStoreError otherwise. */
export function cleanStoreError(error: unknown): unknown {
  if (isAPIError(error) || error instanceof AuthStoreError) return error;
  return new AuthStoreError(storeErrorCode(error));
}

function guard<A extends object>(adapter: A): A {
  const wrapped: Record<string, unknown> = { ...(adapter as Record<string, unknown>) };
  for (const [key, value] of Object.entries(adapter)) {
    if (typeof value !== 'function') continue;
    const method = value as (...args: unknown[]) => unknown;
    wrapped[key] =
      key === 'transaction'
        ? (callback: (trx: object) => Promise<unknown>) =>
            Promise.resolve(method.call(adapter, (trx: object) => callback(guard(trx)))).catch(
              (error: unknown) => {
                throw cleanStoreError(error);
              },
            )
        : (...args: unknown[]) =>
            Promise.resolve(method.apply(adapter, args)).catch((error: unknown) => {
              throw cleanStoreError(error);
            });
  }
  return wrapped as A;
}

/** Wraps an adapter factory (for example `drizzleAdapter(...)`) so that no error of it carries SQL text or parameters. */
export function safeErrorsAdapter<Options extends BetterAuthOptions>(
  factory: AdapterFactory<Options>,
): AdapterFactory<Options> {
  return (options) => guard<DBAdapter<Options>>(factory(options));
}

/** The pool our own auth code queries directly (lockout, 2FA rule, /switch-org), reduced to `query`, the one method it uses. */
export type QueryPool = Pick<ReturnType<typeof createDbPool>, 'query'>;

/** The same guard for that pool: a failed query throws a code-only AuthStoreError. Only the (text, values) form is used. */
export function safeQueryPool(pool: QueryPool): QueryPool {
  const query = (text: string, values?: unknown[]) =>
    pool.query(text, values).catch((error: unknown) => {
      throw cleanStoreError(error);
    });
  return { query: query as QueryPool['query'] };
}
