import { currentTenantContext, type ChannelRefreshClaim, type TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../relay/db-store.js';
import { JobTenantMissingError } from '../tenant-job.js';
import { createDbRefreshStore, type DbRefreshStoreDeps } from './db-store.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const WINDOW = { beforeSeconds: 600, leaseSeconds: 120 };
const KEY = { id: 'ca-1', claimedAt: new Date(1) };

// The SQL functions and `withTenant` are fakes that record the tenant each call runs under. The SQL runs against a real PostgreSQL in
// packages/db/test/channel-refresh.spec.ts.
function setup(claimed: ChannelRefreshClaim[]) {
  const calls: string[] = [];
  const tenants: unknown[] = [];
  const pool = { query: vi.fn(), connect: vi.fn() } as unknown as DbPool;
  const seen = (name: string, value: unknown) => () => {
    calls.push(`${name}@${currentTenantContext().orgId}`);
    return Promise.resolve(value);
  };
  const fns = {
    channelRefreshDueOrgs: vi.fn(() => Promise.resolve([ORG])),
    claimChannelRefresh: vi.fn(seen('claim', claimed)),
    completeChannelRefresh: vi.fn(seen('complete', true)),
    failChannelRefresh: vi.fn(seen('fail', 'connected')),
  } as unknown as NonNullable<DbRefreshStoreDeps['fns']>;
  const inTransaction = vi.fn((_pool: DbPool, tenant: unknown, fn: (tx: TenantTx) => unknown) => {
    tenants.push(tenant);
    return fn({} as TenantTx);
  }) as unknown as NonNullable<DbRefreshStoreDeps['inTransaction']>;
  return { store: createDbRefreshStore({ pool, fns, inTransaction }), fns, pool, calls, tenants };
}

describe('createDbRefreshStore', () => {
  it('asks for the organisations outside a tenant, then claims one account and writes its result in the organisation', async () => {
    const claim = { id: 'ca-1' } as ChannelRefreshClaim;
    const t = setup([claim]);
    expect(await t.store.dueOrgs(5, WINDOW)).toEqual([ORG]);
    expect(vi.mocked(t.fns.channelRefreshDueOrgs)).toHaveBeenCalledWith(t.pool, 5, WINDOW);
    expect(await t.store.claim(ORG, WINDOW)).toBe(claim);
    expect(vi.mocked(t.fns.claimChannelRefresh)).toHaveBeenCalledWith({}, 1, WINDOW);
    expect(await t.store.complete(ORG, KEY, {} as never)).toBe(true);
    const failure = { errorCode: 'E_X', disconnect: false, warnSeconds: 60 };
    expect(await t.store.fail(ORG, KEY, failure)).toBe('connected');
    expect(t.calls).toEqual(['claim', 'complete', 'fail'].map((c) => `${c}@${ORG}`));
    expect(t.tenants).toEqual(Array.from({ length: 3 }, () => ({ orgId: ORG, workspaceIds: [] })));
  });

  it('gives null when no account is due, and refuses a call without a usable organisation before any transaction', async () => {
    const t = setup([]);
    expect(await t.store.claim(ORG, WINDOW)).toBeNull();
    await expect(t.store.claim('', WINDOW)).rejects.toBeInstanceOf(JobTenantMissingError);
    expect(t.tenants).toHaveLength(1);
  });
});
