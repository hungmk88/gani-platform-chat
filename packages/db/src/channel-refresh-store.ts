import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type pg from 'pg';

import { channelAccounts } from './schema/channel-accounts.js';
import type { TenantTx } from './tenant-tx.js';

// The token refresh of the channel accounts (zalo-channel spec §4, B2, N173): which accounts are due, the lease that keeps two jobs
// off one account (a refresh token may be good for one use only), and the one UPDATE that writes the result. Every function but the
// first takes the caller's TenantTx and never commits; row-level security keeps it to the transaction's organisation. Tokens pass
// through as ciphertext of SecretBox, made and read by the caller: nothing here sees a plain token, and nothing is logged. Calling the
// platform is the job's, outside any transaction.

const a = channelAccounts;
const LIVE = ['connected', 'token_expiring'];
/** A code, never a message: a name or a token must not reach `last_error`. Same rule as the inbound store. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

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
  /** A claim older than this is taken back (a job died holding it); a failed account waits this long before its next try. */
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

/** The claim being completed or failed: the account and the `claimedAt` its claim returned. */
export interface ChannelRefreshKey {
  readonly id: string;
  readonly claimedAt: Date;
}

/** Still this claim, of a live account: a job whose lease was taken back, or an account disconnected meanwhile, writes nothing. */
const holds = (key: ChannelRefreshKey) =>
  and(
    eq(a.id, key.id),
    eq(a.refreshClaimedAt, key.claimedAt),
    isNull(a.deletedAt),
    inArray(a.status, LIVE),
  );

export interface RefreshedTokens {
  /** The `keyVersion` of the claim: the tokens must be encrypted with it (see below). */
  readonly keyVersion: number;
  readonly accessTokenEnc: Buffer;
  readonly refreshTokenEnc: Buffer;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date | null;
}

/**
 * Writes the new tokens in one UPDATE: `connected`, no error, claim released. `false`: not the claim of this job any more, nothing
 * written; the caller logs it, the tokens it holds are lost (spec §9). One `key_version` covers every secret column of the row, so the
 * tokens must use the claim's version, and a row whose key changed meanwhile is not written (N173: rotation rewrites all four columns).
 */
export async function completeChannelRefresh(
  tx: TenantTx,
  key: ChannelRefreshKey,
  tokens: RefreshedTokens,
): Promise<boolean> {
  const { keyVersion, ...rest } = tokens;
  const rows = await tx
    .update(a)
    .set({
      ...rest,
      lastRefreshedAt: sql`now()`,
      refreshClaimedAt: null,
      status: 'connected',
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(and(holds(key), eq(a.keyVersion, keyVersion)))
    .returning({ id: a.id });
  return rows.length === 1;
}

export interface ChannelRefreshFailure {
  /** A code, never a message: checked, and never repeated in an error. */
  readonly errorCode: string;
  /** The platform refused the token for good: `disconnected`, claim released, never tried again by the job (spec §4). */
  readonly disconnect: boolean;
  /** Otherwise the account becomes `token_expiring` once a token of it (access or refresh) expires within this many seconds (spec §4:
   * 24 hours). */
  readonly warnSeconds: number;
}

/** Records a failed refresh. Returns the status of the account after it, or `null` when the claim is not this job's any more. */
export async function failChannelRefresh(
  tx: TenantTx,
  key: ChannelRefreshKey,
  failure: ChannelRefreshFailure,
): Promise<string | null> {
  // The error does not repeat the value: it may be the very text this check is there to keep out.
  if (!ERROR_CODE.test(failure.errorCode)) {
    throw new TypeError('error code must match ^[A-Z][A-Z0-9_]{0,63}$ (a code, never a message)');
  }
  assertWhole('warnSeconds', failure.warnSeconds, 0);
  // Transient error does not release the lease; next attempt happens
  // after the lease expires. This is implicit backoff — for precise
  // backoff, add a retry_at column (separate PR).
  const soon = sql`least(${a.accessTokenExpiresAt}, ${a.refreshTokenExpiresAt}) < now() + make_interval(secs => ${failure.warnSeconds})`;
  const [row] = await tx
    .update(a)
    .set(
      failure.disconnect
        ? {
            status: 'disconnected',
            refreshClaimedAt: null,
            lastError: failure.errorCode,
            updatedAt: sql`now()`,
          }
        : {
            status: sql`CASE WHEN ${soon} THEN 'token_expiring' ELSE ${a.status} END`,
            lastError: failure.errorCode,
            updatedAt: sql`now()`,
          },
    )
    .where(holds(key))
    .returning({ status: a.status });
  return row?.status ?? null;
}
