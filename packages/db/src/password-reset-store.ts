import type pg from 'pg';

import { assertUuid } from './validate.js';

// "Quên mật khẩu" (PR7, N84, N162), for the pool of `auth_role`: the person following the link is not signed in. A token is good once,
// for 30 minutes. The token goes to the database as a parameter (never in the text of a query, so never in its log) and only its
// SHA-256 is kept: in `identifier` (as Better Auth keys its own tokens, so the existing index finds it), with the person in `value`.
// A new link ends the ones before it. Emails are stored lower case (users_email_normalized), so the address asked is too. Nothing here
// logs.

/** How long a link to set a new password lasts (N162: 30 minutes, once). */
export const PASSWORD_RESET_MINUTES = 30;

const KEY = `'password-reset:' || encode(sha256(convert_to($1, 'UTF8')), 'hex')`;

/** One transaction of auth_role; an answer of null rolls it back, so a refusal half way changes nothing. */
async function inTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query(result === null ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Makes `token` the one link of the person with `email` to set a new password, or returns null (no active, undeleted person with a
 * password goes by that email). The caller answers both alike and sends the email only on a person. `id` is a UUIDv7 for the row.
 */
export function issuePasswordReset(
  pool: pg.Pool,
  q: { readonly email: string; readonly token: string; readonly id: string },
): Promise<{ userId: string } | null> {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT u.id FROM public.users u
       WHERE u.email = lower(btrim($1)) AND u.status = 'active' AND u.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential')`,
      [q.email],
    );
    const [person] = rows;
    if (!person) return null;
    await client.query(
      `UPDATE public.verifications SET used_at = now(), updated_at = now()
       WHERE value = $1 AND identifier LIKE 'password-reset:%' AND used_at IS NULL AND expires_at > now()`,
      [person.id],
    );
    await client.query(
      `INSERT INTO public.verifications (id, identifier, value, expires_at)
       VALUES ($2, ${KEY}, $3, now() + make_interval(mins => $4))`,
      [q.token, assertUuid(q.id, 'id'), person.id, PASSWORD_RESET_MINUTES],
    );
    return { userId: person.id };
  });
}

/**
 * Spends `token` and gives its person the password `passwordHash` (an Argon2id hash made by the caller, never a password), in ONE
 * transaction: every session of theirs ends, the lock of failed sign-ins is lifted, and `user.password_reset` is audited in each
 * organisation where they are active (app.audit_own_account_event, one id from `newId` each). Null, changing nothing, for a token that
 * is wrong, used, superseded or expired, or a person who is gone: the caller answers them all alike.
 */
export function resetPassword(
  pool: pg.Pool,
  q: { readonly token: string; readonly passwordHash: string; readonly newId: () => string },
): Promise<{ userId: string } | null> {
  return inTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string; user_id: string }>(
      `SELECT v.id, u.id AS user_id FROM public.verifications v
       JOIN public.users u ON u.id::text = v.value AND u.status = 'active' AND u.deleted_at IS NULL
       WHERE v.identifier = ${KEY} AND v.used_at IS NULL AND v.expires_at > now()
       FOR UPDATE OF v`,
      [q.token],
    );
    const [spent] = rows;
    if (!spent) return null;
    const userId = spent.user_id;
    await client.query(
      'UPDATE public.verifications SET used_at = now(), updated_at = now() WHERE id = $1',
      [spent.id],
    );
    const changed = await client.query(
      `UPDATE public.accounts SET password = $2, updated_at = now() WHERE user_id = $1 AND provider_id = 'credential'`,
      [userId, q.passwordHash],
    );
    if (changed.rowCount !== 1) return null;
    await client.query(
      'UPDATE public.sessions SET revoked_at = now(), updated_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    await client.query(
      'UPDATE public.users SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
      [userId],
    );
    await client.query("SELECT set_config('app.auth_user_id', $1, true)", [userId]);
    const orgs = await client.query<{ org_id: string }>(
      `SELECT org_id FROM app.memberships_for_user($1) WHERE status = 'active'`,
      [userId],
    );
    const orgIds = orgs.rows.map((r) => r.org_id);
    await client.query('SELECT app.audit_own_account_event($1, $2::uuid[], $3::uuid[])', [
      'user.password_reset',
      orgIds,
      orgIds.map(() => assertUuid(q.newId(), 'id')),
    ]);
    return { userId };
  });
}
