import { ChannelWindowClosedError } from '@gani/conversations';
import { currentTenantContext, type OutboundClaim, type TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../relay/db-store.js';
import { JobTenantMissingError } from '../tenant-job.js';
import { createDbOutboundStore, type DbOutboundStoreDeps } from './db-store.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const WS = '0197a3c0-0000-7000-8000-000000000002';
const KEY = { id: 'd1', claimedAt: new Date(1) };
const CLAIM = {
  id: 'd1',
  workspaceId: WS,
  conversationId: 'c1',
  message: { kind: 'text', body: 'x', sequenceNumber: 4 },
} as OutboundClaim;

// The SQL functions, the gate and `withTenant` are fakes that record the tenant each call runs under. The SQL runs against a real
// PostgreSQL in packages/db/test/outbound-store.spec.ts.
function setup(check: () => Promise<unknown> = () => Promise.resolve({ state: 'open' })) {
  const calls: string[] = [];
  const tenants: unknown[] = [];
  const pool = { query: vi.fn(), connect: vi.fn() } as unknown as DbPool;
  const seen = (name: string, value: unknown) => () => {
    const t = currentTenantContext();
    calls.push(`${name}@${t.orgId}/${t.workspaceIds.join(',')}`);
    return Promise.resolve(value);
  };
  const fns = {
    outboundPendingOrgs: vi.fn(() => Promise.resolve([ORG])),
    listWorkspaces: vi.fn(seen('workspaces', [{ id: WS }])),
    claimOutboundDelivery: vi.fn(seen('claim', CLAIM)),
    completeOutboundDelivery: vi.fn(seen('complete', true)),
    retryOutboundDelivery: vi.fn(seen('retry', true)),
    failOutboundDelivery: vi.fn(seen('fail', true)),
  } as unknown as NonNullable<DbOutboundStoreDeps['fns']>;
  const inTransaction = vi.fn((_pool: DbPool, tenant: unknown, fn: (tx: TenantTx) => unknown) => {
    tenants.push(tenant);
    return fn({} as TenantTx);
  }) as unknown as NonNullable<DbOutboundStoreDeps['inTransaction']>;
  const policy = { check: vi.fn(check) };
  const store = createDbOutboundStore({ pool, fns, inTransaction, policy: policy as never });
  return { store, fns, pool, calls, tenants, policy };
}

describe('createDbOutboundStore', () => {
  it('asks for the organisations outside a tenant, reads the workspaces in the organisation, and works on a delivery in its workspace', async () => {
    const t = setup();
    expect(await t.store.pendingOrgs(5, 60)).toEqual([ORG]);
    expect(vi.mocked(t.fns.outboundPendingOrgs)).toHaveBeenCalledWith(t.pool, 5, 60);
    expect(await t.store.workspaces(ORG)).toEqual([WS]);
    expect(await t.store.claim(ORG, WS, 60)).toBe(CLAIM);
    expect(vi.mocked(t.fns.claimOutboundDelivery)).toHaveBeenCalledWith({}, 60);
    expect(await t.store.complete(ORG, WS, KEY, 'p1')).toBe(true);
    expect(await t.store.retry(ORG, WS, KEY, { errorCode: 'E_X', delaySeconds: 2 })).toBe(true);
    expect(await t.store.fail(ORG, WS, KEY, 'E_X')).toBe(true);
    expect(t.calls).toEqual([
      `workspaces@${ORG}/`,
      ...['claim', 'complete', 'retry', 'fail'].map((c) => `${c}@${ORG}/${WS}`),
    ]);
  });

  it('asks the one gate for the window, counting the messages before this one, and says closed when it refuses', async () => {
    const t = setup();
    const now = new Date(5);
    expect(await t.store.window(ORG, CLAIM, now)).toBe('open');
    expect(t.policy.check).toHaveBeenCalledWith({}, 'c1', now, 'advisory', { beforeSequence: 4 });
    expect(t.tenants.at(-1)).toEqual({ orgId: ORG, workspaceIds: [WS] });
    const closed = setup(() =>
      Promise.reject(new ChannelWindowClosedError('api_closed', 'window_expired')),
    );
    expect(await closed.store.window(ORG, CLAIM, now)).toBe('closed');
    const broken = setup(() => Promise.reject(new Error('db down')));
    await expect(broken.store.window(ORG, CLAIM, now)).rejects.toThrow('db down');
  });

  it('refuses a call without a usable organisation before any transaction', async () => {
    const t = setup();
    await expect(t.store.claim('', WS, 60)).rejects.toBeInstanceOf(JobTenantMissingError);
    expect(t.tenants).toHaveLength(0);
  });
});
