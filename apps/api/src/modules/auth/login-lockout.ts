import type { createDbPool } from '@gani/db';

import { hashPassword } from './password.js';

// Lock after 5 wrong passwords for 30 minutes, per account (ADR-003, N85). The counters are users.failed_login_count and
// users.locked_until, which auth_role may update; the rule runs in two hooks of /sign-in/email (wired in auth.config.ts).
// Only `query` is used, so the pool may be the guarded one of safeQueryPool (review SEC-01).
type Pool = Pick<ReturnType<typeof createDbPool>, 'query'>;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 30;
/** What the library answers for a wrong password. A locked account must answer exactly this, even for the right password. */
export const WRONG_CREDENTIALS = {
  code: 'INVALID_EMAIL_OR_PASSWORD',
  message: 'Invalid email or password',
} as const;

// An expired lock is cleared in the same round trip, so the first sign-in after it starts again from 0 failures.
const CHECK = `
  WITH cleared AS (
    UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now()
    WHERE email = lower(btrim($1)) AND locked_until <= now() RETURNING id)
  SELECT EXISTS (SELECT 1 FROM users WHERE email = lower(btrim($1)) AND locked_until > now()) AS locked`;
// One statement: PostgreSQL locks the row, so parallel wrong attempts each add exactly 1 and none is lost.
const FAILED = `
  UPDATE users SET failed_login_count = failed_login_count + 1,
    locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
    updated_at = now()
  WHERE email = lower(btrim($1)) AND deleted_at IS NULL`;
const SUCCEEDED = `
  UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = now()
  WHERE email = lower(btrim($1)) AND (failed_login_count <> 0 OR locked_until IS NOT NULL)`;

function text(body: unknown, key: string): string | undefined {
  const value =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : undefined;
}

export function loginLockout(pool: Pool) {
  return {
    /** For the `before` hook: true when the account is locked. It hashes once first, as a wrong password would, so time tells nothing. */
    async isLocked(body: unknown): Promise<boolean> {
      const email = text(body, 'email');
      if (email === undefined) return false;
      const { rows } = await pool.query<{ locked: boolean }>(CHECK, [email]);
      if (rows[0]?.locked !== true) return false;
      await hashPassword(text(body, 'password') ?? '');
      return true;
    },
    /** For the `after` hook, on a wrong password. An address that is no account changes nothing. */
    async failed(body: unknown): Promise<void> {
      const email = text(body, 'email');
      if (email !== undefined) await pool.query(FAILED, [email, MAX_FAILED_LOGINS, LOCK_MINUTES]);
    },
    /** For the `after` hook, on a successful sign-in. */
    async succeeded(body: unknown): Promise<void> {
      const email = text(body, 'email');
      if (email !== undefined) await pool.query(SUCCEEDED, [email]);
    },
  };
}

export type LoginLockout = ReturnType<typeof loginLockout>;
