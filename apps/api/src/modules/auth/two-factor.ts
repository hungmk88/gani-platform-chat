import type { createDbPool } from '@gani/db';

// The rule that Owner, Admin and platform operators use a second factor (ADR-003, N86, N89). Better Auth cannot enforce a rule by role,
// so it is enforced here and the gate is placed by the code that serves each route: /switch-org uses it, and the gate at the edge of
// the HTTP server (two-factor.gate.ts, N93) uses it for every route of the application (the checklist is in N89).
// Only `query` is used, so the pool may be the guarded one of safeQueryPool (review SEC-01).
type Pool = Pick<ReturnType<typeof createDbPool>, 'query'>;

export const TWO_FACTOR_SETUP_REQUIRED = {
  code: 'two_factor_setup_required',
  message: 'Two-factor authentication must be set up first',
} as const;

/**
 * The only routes open to a person who must set up a second factor and has not yet (N86). The one source: 6d reads it, nothing
 * else lists these. /two-factor/verify-totp cannot be told "first time" from its path; for a person who has not enabled 2FA it
 * can only be that confirmation, because the second step of a sign-in exists only for those who have.
 */
export const TWO_FACTOR_SETUP_ROUTES = [
  '/two-factor/enable',
  '/two-factor/verify-totp',
  '/two-factor/generate-backup-codes',
  '/sign-out',
] as const;

export const isSetupRoute = (path: string): boolean =>
  (TWO_FACTOR_SETUP_ROUTES as readonly string[]).includes(path);

// Required: a platform operator, or an ACTIVE owner or admin in ANY organisation the person belongs to, so that switching to another
// organisation later opens no window. A suspended membership does not count. Reads users and app.memberships_for_user, which
// auth_role may already read and call.
const REQUIRED = `(u.is_platform_operator OR EXISTS (
  SELECT 1 FROM app.memberships_for_user(u.id) m WHERE m.status = 'active' AND m.role IN ('owner', 'admin')))`;

export async function requiresTwoFactor(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ required: boolean }>(
    `SELECT ${REQUIRED} AS required FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0]?.required === true;
}

/**
 * True when the person must have a second factor and has not enabled it. One query, so no other source can disagree. Fails closed: a
 * person the query cannot find (unknown, or soft-deleted) is "must", never "not required" (review DB-01: a deleted owner went through).
 */
export async function mustSetUpTwoFactor(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ must: boolean }>(
    `SELECT (${REQUIRED} AND NOT u.two_factor_enabled) AS must FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0]?.must !== false;
}

export interface TwoFactorStatus {
  twoFactorEnabled: boolean;
  required: boolean;
  mustSetUp: boolean;
}

/** What `GET /v1/me/security-status` tells the client, from the same rule and one query, so `mustSetUp` cannot disagree with the gate. */
export async function twoFactorStatus(pool: Pool, userId: string): Promise<TwoFactorStatus | null> {
  const { rows } = await pool.query<{ enabled: boolean; required: boolean }>(
    `SELECT u.two_factor_enabled AS enabled, ${REQUIRED} AS required FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    twoFactorEnabled: row.enabled,
    required: row.required,
    mustSetUp: row.required && !row.enabled,
  };
}
