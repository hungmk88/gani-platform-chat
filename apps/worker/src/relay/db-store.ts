import {
  claimOutboxBatch,
  failOutboxEvent,
  markOutboxPublished,
  outboxStats,
  pendingOrgs,
  reapExpiredOutboxClaims,
  withTenant,
  type TenantTx,
} from '@gani/db';

import type { OutboxTotals } from '../metrics.js';
import { runForJob } from '../tenant-job.js';
import type { RelayStore } from './outbox-relay.js';

/** The connection pool of `app_role`. Its type is taken from `withTenant`: the worker does not import `pg` (ADR-002). */
export type DbPool = Parameters<typeof withTenant>[0];

const dbFunctions = {
  pendingOrgs,
  reapExpiredOutboxClaims,
  claimOutboxBatch,
  markOutboxPublished,
  failOutboxEvent,
};

export interface DbStoreDeps {
  readonly pool: DbPool;
  /** The SQL of `packages/db` and `withTenant`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
  readonly inTransaction?: typeof withTenant;
}

/**
 * The `RelayStore` over PostgreSQL. Each call is one short transaction of one organisation, and its tenant is the `orgId` the relay
 * read from the outbox, set through `runForJob` (P16): an `orgId` that is empty or not a UUID rejects before a connection is taken.
 * Only `pendingOrgs` runs outside a tenant, through its SECURITY DEFINER function (ids only).
 */
export function createDbRelayStore(deps: DbStoreDeps): RelayStore {
  const { pool, fns = dbFunctions, inTransaction = withTenant } = deps;
  const forOrg = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
    runForJob({ orgId }, (tenant) => inTransaction(pool, tenant, fn));
  return {
    pendingOrgs: (limit, leaseSeconds) => fns.pendingOrgs(pool, limit, leaseSeconds),
    reapExpired: (orgId, leaseSeconds, maxAttempts) =>
      forOrg(orgId, (tx) => fns.reapExpiredOutboxClaims(tx, leaseSeconds, maxAttempts)),
    claim: (orgId, limit) => forOrg(orgId, (tx) => fns.claimOutboxBatch(tx, limit)),
    markPublished: (orgId, ids) => forOrg(orgId, (tx) => fns.markOutboxPublished(tx, ids)),
    fail: (orgId, failure) => forOrg(orgId, (tx) => fns.failOutboxEvent(tx, failure)),
  };
}

/** The state of the outbox for `/metrics` (N118): one query outside any tenant, through `app.outbox_stats` (three numbers). */
export function createDbOutboxStats(deps: { readonly pool: DbPool }): () => Promise<OutboxTotals> {
  return () => outboxStats(deps.pool);
}
