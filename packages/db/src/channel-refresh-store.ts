import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type pg from 'pg';

import { channelAccounts } from './schema/channel-accounts.js';
import type { TenantTx } from './tenant-tx.js';

// The token refresh of the channel accounts (zalo-channel spec §4, B2, N173): which accounts are due, and the lease that keeps two
// jobs off one account (a refresh token may be good for one use only). Every function but the first takes the caller's TenantTx and
// never commits; row-level security keeps it to the transaction's organisation. Tokens pass through as ciphertext of SecretBox, made
// and read by the caller: nothing here sees a plain token, and nothing is logged. Calling the platform is the job's, outside any
// transaction.

const a = channelAccounts;
const LIVE = ['connected', 'token_expiring'];

function assertWhole(
  name: string,
  value: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number between ${min} and ${max}`);
  }
}

export interface ChannelRefreshWindow {
  /** An access token that expires within this many seconds is due. */
  readonly beforeSeconds: number;
  /** A claim older than this is taken back (a job died holding it). */
  readonly leaseSeconds: number;
}

/**
 * The organisations that have an account due, the soonest expiry first, asked outside any tenant through
 * `app.channel_refresh_due_orgs` (SECURITY DEFINER, ids only; it checks its own bounds).
 */
export async function channelRefreshDueOrgs(
  pool: pg.Pool,
  limit: number,
  window: ChannelRefreshWindow,
): Promise<string[]> {
  const { rows } = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM app.channel_refresh_due_orgs($1, $2, $3)',
    [limit, window.beforeSeconds, window.leaseSeconds],
  );
  return rows.map((r) => r.org_id);
}

/** An account the job holds. The `…Enc` fields are ciphertext of SecretBox, bound to this row and column, under `keyVersion`. */
// prettier-ignore
export type ChannelRefreshClaim = Pick<
  typeof channelAccounts.$inferSelect,
  'id' | 'workspaceId' | 'appId' | 'appSecretEnc' | 'refreshTokenEnc' | 'keyVersion' | 'accessTokenExpiresAt' | 'refreshTokenExpiresAt' | 'status'
> & {
  /** Names this claim: the write of its result must match the same value. */
  readonly claimedAt: Date;
};

/**
 * Takes up to `limit` due accounts of the tenant's organisation, the soonest expiry first, and stamps `refresh_claimed_at`. The test of
 * "due" is the one of app.channel_refresh_due_orgs: change both together. `FOR UPDATE SKIP LOCKED` hands two jobs that ask at once
 * disjoint accounts instead of one of them waiting for the other; the stamp keeps the account off every later claim until the lease
 * runs out. The stamp is cut to milliseconds, so the Date the caller gets back is the stored value exactly.
 */
export async function claimChannelRefresh(
  tx: TenantTx,
  limit: number,
  window: ChannelRefreshWindow,
): Promise<ChannelRefreshClaim[]> {
  assertWhole('limit', limit, 1, 1000);
  assertWhole('beforeSeconds', window.beforeSeconds, 0);
  assertWhole('leaseSeconds', window.leaseSeconds, 1);
  // prettier-ignore
  const due = tx.select({ id: a.id }).from(a)
    .where(and(eq(a.type, 'zalo_oa'), isNull(a.deletedAt), inArray(a.status, LIVE), isNotNull(a.refreshTokenEnc),
      sql`${a.accessTokenExpiresAt} < now() + make_interval(secs => ${window.beforeSeconds})`,
      or(isNull(a.refreshClaimedAt), sql`${a.refreshClaimedAt} < now() - make_interval(secs => ${window.leaseSeconds})`)))
    .orderBy(a.accessTokenExpiresAt, a.id).limit(limit).for('update', { skipLocked: true });
  // prettier-ignore
  const rows = await tx.update(a)
    .set({ refreshClaimedAt: sql`date_trunc('milliseconds', now())` })
    .where(inArray(a.id, due))
    .returning({ id: a.id, workspaceId: a.workspaceId, appId: a.appId, appSecretEnc: a.appSecretEnc, refreshTokenEnc: a.refreshTokenEnc,
      keyVersion: a.keyVersion, accessTokenExpiresAt: a.accessTokenExpiresAt, refreshTokenExpiresAt: a.refreshTokenExpiresAt,
      status: a.status, claimedAt: a.refreshClaimedAt });
  return rows.map((r) => ({ ...r, claimedAt: r.claimedAt as Date }));
}
