import { ConversationContendedError, type ConversationStateMachine } from '@gani/conversations';
import {
  afterHoursHeldConversations,
  afterHoursHeldOrgs,
  listDaysOff,
  listWorkspaces,
  readWorkingWeek,
  withTenant,
  type TenantTx,
} from '@gani/db';
import { InvalidTransitionError, uuidv7 } from '@gani/domain';

import { workspaceOpenAt } from '../inbound/business-hours.js';
import type { DbPool } from '../relay/db-store.js';
import { runForJob } from '../tenant-job.js';
import type { ReleaseStore } from './release-job.js';

// prettier-ignore
const dbFunctions = { afterHoursHeldOrgs, afterHoursHeldConversations, listWorkspaces, readWorkingWeek, listDaysOff };

export interface DbReleaseStoreDeps {
  readonly pool: DbPool;
  readonly fsm: ConversationStateMachine;
  /** The SQL of `packages/db` and `withTenant`: given by the caller only so that a test can see what is asked. */
  readonly fns?: typeof dbFunctions;
  readonly inTransaction?: typeof withTenant;
}

/**
 * The `ReleaseStore` over PostgreSQL. Only `heldOrgs` runs outside a tenant, through its SECURITY DEFINER function (ids only); the
 * workspaces are listed in a tenant of the organisation, and a workspace's conversations and their release run in a tenant of that
 * workspace (conversations are filtered by organisation and workspace), each set through `runForJob` (P16).
 */
export function createDbReleaseStore(deps: DbReleaseStoreDeps): ReleaseStore {
  const { pool, fsm, fns = dbFunctions, inTransaction = withTenant } = deps;
  const forJob = <T>(
    ids: { orgId: string; workspaceId?: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> => runForJob(ids, (tenant) => inTransaction(pool, tenant, fn));
  return {
    heldOrgs: (limit) => fns.afterHoursHeldOrgs(pool, limit),
    openWithHeld: async (orgId, at, limit) => {
      const workspaces = await forJob({ orgId }, (tx) => fns.listWorkspaces(tx));
      const open = [];
      for (const { id: workspaceId } of workspaces) {
        const conversationIds = await forJob({ orgId, workspaceId }, async (tx) => {
          const held = await fns.afterHoursHeldConversations(tx, workspaceId, limit);
          if (held.length === 0) return held;
          return (await workspaceOpenAt(tx, fns, workspaceId, at)) ? held : [];
        });
        if (conversationIds.length > 0) open.push({ workspaceId, conversationIds });
      }
      return open;
    },
    release: (orgId, workspaceId, conversationId) =>
      forJob({ orgId, workspaceId }, async (tx) => {
        try {
          const moved = await fsm.transition(
            tx,
            conversationId,
            { type: 'release_after_hours', inHours: true },
            { actor: { kind: 'system' }, traceId: uuidv7() },
          );
          return moved.kind === 'changed';
        } catch (error) {
          // Taken by a person while held (T06), or released by another worker: no longer this job's.
          if (
            error instanceof InvalidTransitionError ||
            error instanceof ConversationContendedError
          )
            return false;
          throw error;
        }
      }),
  };
}
