import {
  channelRefreshDueOrgs,
  claimChannelRefresh,
  completeChannelRefresh,
  failChannelRefresh,
  withTenant,
  type TenantTx,
} from '@gani/db';

import type { DbPool } from '../relay/db-store.js';
import { runForJob } from '../tenant-job.js';
import type { RefreshStore } from './token-refresh.js';

const dbFunctions = {
  channelRefreshDueOrgs,
  claimChannelRefresh,
  completeChannelRefresh,
  failChannelRefresh,
};

export interface DbRefreshStoreDeps {
  readonly pool: DbPool;
  /** The SQL of `packages/db` and `withTenant`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
  readonly inTransaction?: typeof withTenant;
}

/**
 * The `RefreshStore` over PostgreSQL: each step is one short transaction of the organisation (`channel_accounts` is filtered by
 * organisation only), its tenant set through `runForJob` (P16). A claim takes one account (limit 1). Only `dueOrgs` runs outside a
 * tenant, through its SECURITY DEFINER function (ids only).
 */
export function createDbRefreshStore(deps: DbRefreshStoreDeps): RefreshStore {
  const { pool, fns = dbFunctions, inTransaction = withTenant } = deps;
  const forOrg = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
    runForJob({ orgId }, (tenant) => inTransaction(pool, tenant, fn));
  return {
    dueOrgs: (limit, window) => fns.channelRefreshDueOrgs(pool, limit, window),
    claim: async (orgId, window) =>
      (await forOrg(orgId, (tx) => fns.claimChannelRefresh(tx, 1, window)))[0] ?? null,
    complete: (orgId, key, tokens) =>
      forOrg(orgId, (tx) => fns.completeChannelRefresh(tx, key, tokens)),
    fail: (orgId, key, failure) => forOrg(orgId, (tx) => fns.failChannelRefresh(tx, key, failure)),
  };
}
