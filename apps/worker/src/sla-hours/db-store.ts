import { SlaClock } from '@gani/conversations';
import {
  listDaysOff,
  listWorkspaces,
  readWorkingWeek,
  slaClockConversations,
  slaRunningOrgs,
  withTenant,
  type TenantTx,
} from '@gani/db';
import { uuidv7 } from '@gani/domain';

import { workspaceOpenAt } from '../inbound/business-hours.js';
import type { DbPool } from '../relay/db-store.js';
import { runForJob } from '../tenant-job.js';
import type { SlaHoursStore } from './store.js';

// prettier-ignore
const dbFunctions = { slaRunningOrgs, slaClockConversations, listWorkspaces, readWorkingWeek, listDaysOff };

export interface DbSlaHoursStoreDeps {
  readonly pool: DbPool;
  readonly clock?: SlaClock;
  /** The SQL of `packages/db` and `withTenant`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
  readonly inTransaction?: typeof withTenant;
}

/**
 * The `SlaHoursStore` over PostgreSQL. Only `runningOrgs` runs outside a tenant, through its SECURITY DEFINER function (ids only); the
 * workspaces are listed in a tenant of the organisation, and a workspace's conversations and their SLA in a tenant of that workspace,
 * each set through `runForJob` (P16). A closed workspace lists its running SLAs, an open one those paused outside the hours.
 */
export function createDbSlaHoursStore(deps: DbSlaHoursStoreDeps): SlaHoursStore {
  const { pool, clock = new SlaClock(), fns = dbFunctions, inTransaction = withTenant } = deps;
  const forJob = <T>(
    ids: { orgId: string; workspaceId?: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> => runForJob(ids, (tenant) => inTransaction(pool, tenant, fn));
  return {
    runningOrgs: (limit) => fns.slaRunningOrgs(pool, limit),
    toMove: async (orgId, at, limit) => {
      const workspaces = await forJob({ orgId }, (tx) => fns.listWorkspaces(tx));
      const moving = [];
      for (const { id: workspaceId } of workspaces) {
        const conversationIds = await forJob({ orgId, workspaceId }, async (tx) => {
          const open = await workspaceOpenAt(tx, fns, workspaceId, at);
          return fns.slaClockConversations(tx, workspaceId, open, limit);
        });
        if (conversationIds.length > 0) moving.push({ workspaceId, conversationIds });
      }
      return moving;
    },
    move: (orgId, workspaceId, conversationId, at) =>
      forJob({ orgId, workspaceId }, (tx) => clock.atHours(tx, conversationId, at, uuidv7())),
  };
}
