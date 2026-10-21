import { currentTenantContext, type ClaimedInboundEvent, type TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../relay/db-store.js';
import { JobTenantMissingError } from '../tenant-job.js';
import { createDbInboundStore, type DbInboundStoreDeps } from './db-store.js';
import type { InboundServices } from './process-event.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const WS = '0197a3c0-0000-7000-8000-000000000002';
const event = { id: 'e-1', orgId: ORG, workspaceId: WS } as ClaimedInboundEvent;

// The SQL functions, the processing and `withTenant` are fakes that record the tenant each call runs under. The SQL runs against a
// real PostgreSQL in test/inbound-loop.spec.ts.
function setup() {
  const calls: string[] = [];
  const tenants: unknown[] = [];
  const pool = { query: vi.fn(), connect: vi.fn() } as unknown as DbPool;
  const services = {} as InboundServices;
  const seen = (name: string) => () => {
    calls.push(`${name}@${currentTenantContext().orgId}`);
    return Promise.resolve(name);
  };
  const fns = {
    pendingInboundOrgs: vi.fn(() => Promise.resolve([ORG])),
    reapExpiredInboundClaims: vi.fn(seen('reap')),
    pendingInboundWorkspaces: vi.fn(seen('workspaces')),
    claimInboundBatch: vi.fn(seen('claim')),
    failInboundEvent: vi.fn(seen('fail')),
    processInboundEvent: vi.fn(seen('process')),
  } as unknown as NonNullable<DbInboundStoreDeps['fns']>;
  const inTransaction = vi.fn((_pool: DbPool, tenant: unknown, fn: (tx: TenantTx) => unknown) => {
    tenants.push(tenant);
    return fn({} as TenantTx);
  }) as unknown as NonNullable<DbInboundStoreDeps['inTransaction']>;
  return {
    store: createDbInboundStore({ pool, services, fns, inTransaction }),
    fns,
    calls,
    tenants,
    services,
  };
}

describe('createDbInboundStore', () => {
  it('runs the bookkeeping in the organisation, and the processing in the workspace of the event', async () => {
    const t = setup();
    expect(await t.store.pendingOrgs(5, 60)).toEqual([ORG]);
    await t.store.reapExpired(ORG, 60, 5);
    await t.store.pendingWorkspaces(ORG);
    await t.store.claim(ORG, WS, 10);
    await t.store.process(event);
    await t.store.fail(ORG, {
      id: 'e-1',
      receivedAt: new Date(0),
      attempts: 1,
      errorCode: 'E_PROCESS',
      maxAttempts: 5,
      retryAfterSeconds: 2,
    });
    expect(t.calls).toEqual(
      ['reap', 'workspaces', 'claim', 'process', 'fail'].map((c) => `${c}@${ORG}`),
    );
    expect(t.tenants).toEqual([
      ...Array.from({ length: 3 }, () => ({ orgId: ORG, workspaceIds: [] })),
      { orgId: ORG, workspaceIds: [WS] },
      { orgId: ORG, workspaceIds: [] },
    ]);
    expect(vi.mocked(t.fns.claimInboundBatch)).toHaveBeenCalledWith(
      {},
      { limit: 10, workspaceId: WS },
    );
    expect(vi.mocked(t.fns.processInboundEvent)).toHaveBeenCalledWith({}, event, t.services);
  });

  it('refuses an event without a usable organisation before any transaction', async () => {
    const t = setup();
    await expect(t.store.process({ ...event, orgId: '' })).rejects.toBeInstanceOf(
      JobTenantMissingError,
    );
    await expect(t.store.claim('', WS, 1)).rejects.toBeInstanceOf(JobTenantMissingError);
    expect(t.tenants).toEqual([]);
  });
});
