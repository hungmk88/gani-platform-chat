import { currentTenantContext, type TenantTx } from '@gani/db';
import type { SlaClock } from '@gani/conversations';
import { DEFAULT_WORKING_WEEK } from '@gani/domain';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../relay/db-store.js';
import { JobTenantMissingError } from '../tenant-job.js';
import { createDbSlaHoursStore, type DbSlaHoursStoreDeps } from './db-store.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const [OPEN, CLOSED] = [
  '0197a3c0-0000-7000-8000-0000000000a1',
  '0197a3c0-0000-7000-8000-0000000000a2',
];
const TUESDAY_10H = new Date('2026-11-03T03:00:00Z'); // in Ho Chi Minh City

// The SQL functions, `withTenant` and the SlaClock are fakes that record what they are asked and under which tenant; the SQL runs
// against PostgreSQL in packages/db/test/sla-clock-store.spec.ts and the SlaClock in the API's integration test of the SLA (E4b).
function setup() {
  const tenants: unknown[] = [];
  const pool = { query: vi.fn(), connect: vi.fn() } as unknown as DbPool;
  const fns = {
    slaRunningOrgs: vi.fn(() => Promise.resolve([ORG])),
    listWorkspaces: vi.fn(() => Promise.resolve([OPEN, CLOSED].map((id) => ({ id })))),
    slaClockConversations: vi.fn((_tx: TenantTx, ws: string, paused: boolean) =>
      Promise.resolve(ws === OPEN && !paused ? [] : [`c-${ws}`]),
    ),
    readWorkingWeek: vi.fn((_tx: TenantTx, ws: string) =>
      Promise.resolve({
        timezone: 'Asia/Ho_Chi_Minh',
        week: ws === CLOSED ? Array.from({ length: 7 }, () => null) : DEFAULT_WORKING_WEEK,
        isDefault: false,
      }),
    ),
    listDaysOff: vi.fn(() => Promise.resolve([])),
  } as unknown as NonNullable<DbSlaHoursStoreDeps['fns']>;
  const inTransaction = vi.fn((_pool: DbPool, tenant: unknown, fn: (tx: TenantTx) => unknown) => {
    tenants.push(tenant);
    expect(currentTenantContext()).toEqual(tenant);
    return fn({} as TenantTx);
  }) as unknown as NonNullable<DbSlaHoursStoreDeps['inTransaction']>;
  const clock = { atHours: vi.fn(() => Promise.resolve(true)) };
  const store = createDbSlaHoursStore({
    pool,
    clock: clock as unknown as SlaClock,
    fns,
    inTransaction,
  });
  return { store, fns, pool, clock, tenants };
}

describe('createDbSlaHoursStore', () => {
  it('asks for the organisations outside a tenant; an open workspace lists the paused SLAs, a closed one the running ones', async () => {
    const t = setup();
    expect(await t.store.runningOrgs(7)).toEqual([ORG]);
    expect(vi.mocked(t.fns.slaRunningOrgs)).toHaveBeenCalledWith(t.pool, 7);
    expect(await t.store.toMove(ORG, TUESDAY_10H, 5)).toEqual([
      { workspaceId: OPEN, conversationIds: [`c-${OPEN}`] },
      { workspaceId: CLOSED, conversationIds: [`c-${CLOSED}`] },
    ]);
    expect(vi.mocked(t.fns.slaClockConversations).mock.calls).toEqual([
      [{}, OPEN, true, 5],
      [{}, CLOSED, false, 5],
    ]);
    expect(t.tenants).toEqual([
      { orgId: ORG, workspaceIds: [] },
      ...[OPEN, CLOSED].map((ws) => ({ orgId: ORG, workspaceIds: [ws] })),
    ]);
  });

  it('moves one SLA through the SlaClock at the time of the pass, in a tenant of its workspace', async () => {
    const t = setup();
    expect(await t.store.move(ORG, OPEN, 'c1', TUESDAY_10H)).toBe(true);
    expect(t.clock.atHours).toHaveBeenCalledWith(
      {},
      'c1',
      TUESDAY_10H,
      expect.any(String) as unknown,
    );
    expect(t.tenants).toEqual([{ orgId: ORG, workspaceIds: [OPEN] }]);
  });

  it('refuses a call without a usable organisation before any transaction', async () => {
    const t = setup();
    await expect(t.store.move('', OPEN, 'c1', TUESDAY_10H)).rejects.toBeInstanceOf(
      JobTenantMissingError,
    );
    expect(t.tenants).toEqual([]);
  });
});
