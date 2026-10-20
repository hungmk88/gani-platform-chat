import {
  claimInboundBatch,
  failInboundEvent,
  pendingInboundOrgs,
  pendingInboundWorkspaces,
  reapExpiredInboundClaims,
  withTenant,
  type TenantTx,
} from '@gani/db';

import type { DbPool } from '../relay/db-store.js';
import { runForJob } from '../tenant-job.js';
import type { InboundStore } from './inbound-processor.js';
import { processInboundEvent, type InboundServices } from './process-event.js';

const dbFunctions = {
  pendingInboundOrgs,
  reapExpiredInboundClaims,
  pendingInboundWorkspaces,
  claimInboundBatch,
  failInboundEvent,
  processInboundEvent,
};

export interface DbInboundStoreDeps {
  readonly pool: DbPool;
  readonly services: InboundServices;
  /** The SQL of `packages/db`, the processing and `withTenant`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
  readonly inTransaction?: typeof withTenant;
}

/**
 * The `InboundStore` over PostgreSQL. The bookkeeping (reap, workspaces, claim, fail) is one short transaction of the organisation
 * (`inbound_events` is filtered by organisation only); processing one event is a transaction in the tenant of the event, its workspace
 * included, because conversations and messages are filtered by workspace. Both tenants come from the rows, set through `runForJob`
 * (P16). Only `pendingOrgs` runs outside a tenant, through its SECURITY DEFINER function (ids only).
 */
export function createDbInboundStore(deps: DbInboundStoreDeps): InboundStore {
  const { pool, services, fns = dbFunctions, inTransaction = withTenant } = deps;
  const forOrg = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
    runForJob({ orgId }, (tenant) => inTransaction(pool, tenant, fn));
  return {
    pendingOrgs: (limit, leaseSeconds) => fns.pendingInboundOrgs(pool, limit, leaseSeconds),
    reapExpired: (orgId, leaseSeconds, maxAttempts) =>
      forOrg(orgId, (tx) => fns.reapExpiredInboundClaims(tx, leaseSeconds, maxAttempts)),
    pendingWorkspaces: (orgId) => forOrg(orgId, (tx) => fns.pendingInboundWorkspaces(tx)),
    claim: (orgId, workspaceId, limit) =>
      forOrg(orgId, (tx) => fns.claimInboundBatch(tx, { limit, workspaceId })),
    process: (event) =>
      runForJob({ orgId: event.orgId, workspaceId: event.workspaceId }, (tenant) =>
        inTransaction(pool, tenant, (tx) => fns.processInboundEvent(tx, event, services)),
      ),
    fail: (orgId, failure) => forOrg(orgId, (tx) => fns.failInboundEvent(tx, failure)),
  };
}
