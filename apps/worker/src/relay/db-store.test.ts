import { InvalidTenantContextError, currentTenantContext, type TenantTx } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { JobTenantMissingError } from '../tenant-job.js';
import { createDbRelayStore, type DbPool, type DbStoreDeps } from './db-store.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const failure = {
  id: 'e-1',
  attempts: 2,
  errorCode: 'E_QUEUE',
  maxAttempts: 5,
  retryAfterSeconds: 4,
};

// The SQL functions and `withTenant` are fakes that record what they are given, so the tests see which tenant each call runs under
// and which calls are made at all. The SQL itself runs against a real PostgreSQL in O-5.
function setup() {
  const calls: string[] = [];
  const tenants: unknown[] = [];
  const tx = { marker: 'tx' } as unknown as TenantTx;
  const query = vi.fn();
  const connect = vi.fn();
  const pool = { query, connect } as unknown as DbPool;
  const seen = (name: string, ...args: unknown[]) => {
    calls.push(`${name}@${currentTenantContext().orgId}(${args.map(String).join(',')})`);
  };
  const inTransaction = vi.fn(
    (_pool: DbPool, tenant: unknown, fn: (tx: TenantTx) => Promise<unknown>) => {
      tenants.push(tenant);
      return fn(tx);
    },
  );
  const fns = {
    pendingOrgs: vi.fn((_pool: DbPool, limit: number, lease: number) => {
      calls.push(`pendingOrgs(${limit},${lease})`);
      return Promise.resolve([ORG]);
    }),
    reapExpiredOutboxClaims: vi.fn((_tx: TenantTx, lease: number, max: number) => {
      seen('reap', lease, max);
      return Promise.resolve(3);
    }),
    claimOutboxBatch: vi.fn((_tx: TenantTx, limit: number) => {
      seen('claim', limit);
      return Promise.resolve([]);
    }),
    markOutboxPublished: vi.fn((_tx: TenantTx, ids: readonly string[]) => {
      seen('mark', ids.join('+'));
      return Promise.resolve(ids.length);
    }),
    failOutboxEvent: vi.fn((_tx: TenantTx, f: { id: string }) => {
      seen('fail', f.id);
      return Promise.resolve('pending' as const);
    }),
  } as unknown as NonNullable<DbStoreDeps['fns']>;
  const store = createDbRelayStore({
    pool,
    fns,
    inTransaction: inTransaction as unknown as NonNullable<DbStoreDeps['inTransaction']>,
  });
  return { store, calls, tenants, tx, pool, query, connect, inTransaction, fns };
}

describe('each step runs in one transaction of the organisation it names', () => {
  it('sets the organisation as the tenant, with no workspace, and gives the transaction to the SQL function', async () => {
    const t = setup();
    expect(await t.store.reapExpired(ORG, 60, 5)).toBe(3);
    expect(await t.store.claim(ORG, 100)).toEqual([]);
    expect(await t.store.markPublished(ORG, ['e-1', 'e-2'])).toBe(2);
    expect(await t.store.fail(ORG, failure)).toBe('pending');
    expect(t.calls).toEqual([
      `reap@${ORG}(60,5)`,
      `claim@${ORG}(100)`,
      `mark@${ORG}(e-1+e-2)`,
      `fail@${ORG}(e-1)`,
    ]);
    expect(t.inTransaction).toHaveBeenCalledTimes(4);
    expect(t.tenants).toEqual(Array.from({ length: 4 }, () => ({ orgId: ORG, workspaceIds: [] })));
    expect(vi.mocked(t.fns.claimOutboxBatch).mock.calls[0]?.[0]).toBe(t.tx);
  });

  it('asks which organisations have work through the pool, outside any tenant', async () => {
    const t = setup();
    expect(await t.store.pendingOrgs(50, 60)).toEqual([ORG]);
    expect(t.calls).toEqual(['pendingOrgs(50,60)']);
    expect(vi.mocked(t.fns.pendingOrgs).mock.calls[0]?.[0]).toBe(t.pool);
    expect(t.inTransaction).not.toHaveBeenCalled();
  });
});

describe('an organisation that is empty or not a UUID is refused before any query (P16)', () => {
  type Store = ReturnType<typeof setup>['store'];
  const steps: Record<string, (store: Store, org: string) => Promise<unknown>> = {
    reapExpired: (store, org) => store.reapExpired(org, 60, 5),
    claim: (store, org) => store.claim(org, 10),
    markPublished: (store, org) => store.markPublished(org, ['e-1']),
    fail: (store, org) => store.fail(org, failure),
  };

  it.each(Object.entries(steps))(
    '%s with an empty organisation runs nothing',
    async (_name, step) => {
      const t = setup();
      await expect(step(t.store, '')).rejects.toThrowError(JobTenantMissingError);
      expect(t.inTransaction).not.toHaveBeenCalled();
      expect(t.calls).toEqual([]);
    },
  );

  // With the real `withTenant`: the check is in the database package, so it is shown to stop before the pool is touched.
  it.each(Object.entries(steps))(
    '%s with an organisation that is not a UUID never takes a connection',
    async (_name, step) => {
      const t = setup();
      const store = createDbRelayStore({ pool: t.pool, fns: t.fns });
      await expect(step(store, 'not-a-uuid')).rejects.toThrowError(InvalidTenantContextError);
      expect(t.connect).not.toHaveBeenCalled();
      expect(t.query).not.toHaveBeenCalled();
      expect(t.calls).toEqual([]);
    },
  );
});
