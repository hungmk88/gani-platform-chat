import { ADVISORY, ChannelPolicyService, ChannelWindowClosedError } from '@gani/conversations';
import {
  claimOutboundDelivery,
  completeOutboundDelivery,
  failOutboundDelivery,
  listWorkspaces,
  outboundPendingOrgs,
  retryOutboundDelivery,
  withTenant,
  type TenantTx,
} from '@gani/db';

import type { DbPool } from '../relay/db-store.js';
import { runForJob } from '../tenant-job.js';
import type { OutboundStore } from './outbound-sender.js';

const dbFunctions = {
  outboundPendingOrgs,
  listWorkspaces,
  claimOutboundDelivery,
  completeOutboundDelivery,
  retryOutboundDelivery,
  failOutboundDelivery,
};

export interface DbOutboundStoreDeps {
  readonly pool: DbPool;
  /** The one gate of a send to a channel (channel-policy-spec §3, N146). */
  readonly policy?: Pick<ChannelPolicyService, 'check'>;
  /** The SQL of `packages/db` and `withTenant`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
  readonly inTransaction?: typeof withTenant;
}

/**
 * The `OutboundStore` over PostgreSQL. The workspaces are read in a transaction of the organisation (`workspaces` is filtered by
 * organisation only); every step on a delivery is one short transaction of its organisation and workspace (`message_deliveries` is
 * filtered by both), both from the rows and set through `runForJob` (P16). Only `pendingOrgs` runs outside a tenant, through its
 * SECURITY DEFINER function (ids only). The window is asked of ChannelPolicyService.check, counting the messages before this one.
 */
export function createDbOutboundStore(deps: DbOutboundStoreDeps): OutboundStore {
  const {
    pool,
    policy = new ChannelPolicyService(),
    fns = dbFunctions,
    inTransaction = withTenant,
  } = deps;
  const forOrg = <T>(orgId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> =>
    runForJob({ orgId }, (tenant) => inTransaction(pool, tenant, fn));
  const forWorkspace = <T>(
    orgId: string,
    workspaceId: string,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> => runForJob({ orgId, workspaceId }, (tenant) => inTransaction(pool, tenant, fn));
  return {
    pendingOrgs: (limit, leaseSeconds) => fns.outboundPendingOrgs(pool, limit, leaseSeconds),
    workspaces: (orgId) =>
      forOrg(orgId, async (tx) => (await fns.listWorkspaces(tx)).map((w) => w.id)),
    claim: (orgId, workspaceId, leaseSeconds) =>
      forWorkspace(orgId, workspaceId, (tx) => fns.claimOutboundDelivery(tx, leaseSeconds)),
    window: (orgId, claim, now) =>
      forWorkspace(orgId, claim.workspaceId, async (tx) => {
        try {
          await policy.check(tx, claim.conversationId, now, ADVISORY, {
            beforeSequence: claim.message.sequenceNumber,
          });
          return 'open';
        } catch (error) {
          if (error instanceof ChannelWindowClosedError) return 'closed';
          throw error;
        }
      }),
    complete: (orgId, workspaceId, key, platformMessageId) =>
      forWorkspace(orgId, workspaceId, (tx) =>
        fns.completeOutboundDelivery(tx, key, platformMessageId),
      ),
    retry: (orgId, workspaceId, key, failure) =>
      forWorkspace(orgId, workspaceId, (tx) => fns.retryOutboundDelivery(tx, key, failure)),
    fail: (orgId, workspaceId, key, errorCode) =>
      forWorkspace(orgId, workspaceId, (tx) => fns.failOutboundDelivery(tx, key, errorCode)),
  };
}
