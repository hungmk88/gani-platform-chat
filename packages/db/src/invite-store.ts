import type pg from 'pg';

import { assertUuid } from './validate.js';

// The invitation functions of spec RLS M01 §3.7 (migration 202610221000, N147), for the pool of `auth_role`: the person following the
// link has no tenant yet. The token goes to the database as a parameter (never in the text of a query, so never in its log) and is
// hashed there. Nothing here logs.

export interface InviteView {
  readonly memberId: string;
  readonly orgId: string;
  readonly invitedEmail: string;
  readonly role: string;
}

export interface AcceptedInvite {
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
}

/** Every refusal of an invitation, whatever its reason (§3.7 step 4): the caller answers them all alike. */
export class InvalidInviteError extends Error {
  readonly code = 'invite_invalid';
  constructor() {
    super('the invitation is not valid');
    this.name = 'InvalidInviteError';
  }
}

/** The live invitation of `token`, or null (wrong, expired, used or withdrawn: the same null). */
export async function lookupInvite(pool: pg.Pool, token: string): Promise<InviteView | null> {
  const { rows } = await pool.query<{
    member_id: string;
    org_id: string;
    invited_email: string;
    role: string;
  }>('SELECT member_id, org_id, invited_email, role FROM app.lookup_invite($1)', [token]);
  const [row] = rows;
  return row
    ? {
        memberId: row.member_id,
        orgId: row.org_id,
        invitedEmail: row.invited_email,
        role: row.role,
      }
    : null;
}

/**
 * Accepts the invitation of `token` once, in a transaction of its own. `newUserId` is a UUIDv7 the caller makes, used only when the
 * person has no account yet. `signedInUserId` is the person of an AUTHENTICATED session when there is one (it becomes
 * app.auth_user_id, like withAuthUser), never a value from a request. Any refusal is InvalidInviteError; a database error is thrown as
 * it is.
 */
export async function acceptInvite(
  pool: pg.Pool,
  token: string,
  newUserId: string,
  signedInUserId: string | null = null,
): Promise<AcceptedInvite> {
  const id = assertUuid(newUserId, 'newUserId');
  const signedIn = signedInUserId === null ? '' : assertUuid(signedInUserId, 'signedInUserId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.auth_user_id', $1, true)", [signedIn]);
    const { rows } = await client.query<{ user_id: string; org_id: string; role: string }>(
      'SELECT user_id, org_id, role FROM app.accept_invite($1, $2)',
      [token, id],
    );
    await client.query('COMMIT');
    const [row] = rows;
    if (!row) throw new InvalidInviteError();
    return { userId: row.user_id, orgId: row.org_id, role: row.role };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof InvalidInviteError || (error as { code?: unknown }).code === 'IV001')
      throw new InvalidInviteError();
    throw error;
  } finally {
    client.release();
  }
}
