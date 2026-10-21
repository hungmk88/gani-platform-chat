import { and, eq, sql } from 'drizzle-orm';
import type pg from 'pg';

import { idempotencyKeys } from './schema/idempotency-keys.js';
import { currentTenantContext } from './tenant-context.js';
import type { TenantTx } from './tenant-tx.js';
import { assertUuid } from './validate.js';

// Idempotency-Key (Brief P9: "bắt buộc cho mọi POST tạo dữ liệu từ client; server lưu 24 giờ; gửi lại trả kết quả cũ", N134).
// The API calls `beginIdempotent` in its own short transaction before the handler runs, so a second request with the same key sees
// `in_progress` at once, then `completeIdempotent` (or `failIdempotent`) in another one after. Every call runs in the TenantTx of the
// session: RLS keeps the keys of one organisation away from another.

export const IDEMPOTENCY_TTL_HOURS = 24;
/** An attempt still `in_progress` after this long is taken as dead (its process stopped) and the key may be used again. */
export const IDEMPOTENCY_STALE_SECONDS = 60;

export interface IdempotencyRequest {
  readonly userId: string;
  readonly key: string;
  readonly method: string;
  readonly path: string;
  /** sha256 (hex) of what makes two requests the same: method, path and body (the API computes it). */
  readonly requestHash: string;
}

export type IdempotencyBegin =
  | { readonly kind: 'new' }
  | { readonly kind: 'replay'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'mismatch' };

const k = idempotencyKeys;
const own = (userId: string, key: string) =>
  and(
    eq(k.orgId, currentTenantContext().orgId),
    eq(k.userId, assertUuid(userId, 'userId')),
    eq(k.key, key),
  );

/** Claims the key for this request, or says what the earlier request with it left. Never commits: the caller's transaction does. */
export async function beginIdempotent(
  tx: TenantTx,
  r: IdempotencyRequest,
  again = true,
): Promise<IdempotencyBegin> {
  const fields = { method: r.method, path: r.path, requestHash: r.requestHash };
  const inserted = await tx
    .insert(k)
    .values({
      orgId: currentTenantContext().orgId,
      userId: assertUuid(r.userId, 'userId'),
      key: r.key,
      ...fields,
    })
    .onConflictDoNothing()
    .returning({ key: k.key });
  if (inserted.length > 0) return { kind: 'new' };

  const [row] = await tx
    .select({
      method: k.method,
      path: k.path,
      requestHash: k.requestHash,
      status: k.status,
      responseStatus: k.responseStatus,
      responseBody: k.responseBody,
      expired: sql<boolean>`${k.createdAt} < now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`,
      stale: sql<boolean>`${k.updatedAt} < now() - make_interval(secs => ${IDEMPOTENCY_STALE_SECONDS})`,
    })
    .from(k)
    .where(own(r.userId, r.key))
    .for('update');
  // The INSERT conflicted, so the row existed; app.purge_idempotency_keys may have removed it (older than 24 hours) since. Once more,
  // then the INSERT goes through. RLS cannot hide it: the conflict was within the organisation.
  if (!row && again) return beginIdempotent(tx, r, false);
  if (!row) throw new Error('idempotency key vanished between the insert and the read');

  const reset = async (): Promise<IdempotencyBegin> => {
    await tx
      .update(k)
      .set({
        ...fields,
        status: 'in_progress',
        responseStatus: null,
        responseBody: null,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(own(r.userId, r.key));
    return { kind: 'new' };
  };
  if (row.expired) return reset();
  if (row.method !== r.method || row.path !== r.path || row.requestHash !== r.requestHash)
    return { kind: 'mismatch' };
  if (row.status === 'failed' || (row.status === 'in_progress' && row.stale)) return reset();
  if (row.status === 'done' && row.responseStatus !== null)
    return { kind: 'replay', status: row.responseStatus, body: row.responseBody };
  return { kind: 'in_progress' };
}

/** Keeps the answer (a 2xx or a 4xx) to give back to the same key; false when the claim is gone (reset by a later request). */
export async function completeIdempotent(
  tx: TenantTx,
  r: {
    readonly userId: string;
    readonly key: string;
    readonly status: number;
    readonly body: unknown;
  },
): Promise<boolean> {
  if (!Number.isInteger(r.status) || r.status < 200 || r.status > 499)
    throw new RangeError('status must be 200..499');
  const rows = await tx
    .update(k)
    .set({
      status: 'done',
      responseStatus: r.status,
      responseBody: r.body ?? null,
      updatedAt: sql`now()`,
    })
    .where(and(own(r.userId, r.key), eq(k.status, 'in_progress')))
    .returning({ key: k.key });
  return rows.length > 0;
}

/** The attempt failed without an answer to keep (a 5xx): the same key may be sent again at once. */
export async function failIdempotent(
  tx: TenantTx,
  r: { readonly userId: string; readonly key: string },
): Promise<void> {
  await tx
    .update(k)
    .set({ status: 'failed', updatedAt: sql`now()` })
    .where(and(own(r.userId, r.key), eq(k.status, 'in_progress')));
}

export const IDEMPOTENCY_PURGE_LIMIT = 10_000;

/**
 * Removes the keys older than `retentionHours`, at most `limit`, for every organisation (`app.purge_idempotency_keys`, SECURITY
 * DEFINER; it refuses less than 24 hours and a limit outside 1..10000 with 22023). Returns how many it removed; the caller asks again
 * until it gets 0. On the pool of app_role, outside any tenant.
 */
export async function purgeIdempotencyKeys(
  pool: pg.Pool,
  retentionHours: number,
  limit: number,
): Promise<number> {
  const { rows } = await pool.query<{ removed: number }>(
    'SELECT app.purge_idempotency_keys($1, $2) AS removed',
    [retentionHours, limit],
  );
  return rows[0]?.removed ?? 0;
}
