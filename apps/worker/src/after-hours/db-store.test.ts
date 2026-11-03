import { currentTenantContext, type TenantTx } from '@gani/db';
import type { ConversationStateMachine } from '@gani/conversations';
import { ConversationContendedError } from '@gani/conversations';
import { DEFAULT_WORKING_WEEK, InvalidTransitionError } from '@gani/domain';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../relay/db-store.js';
import { JobTenantMissingError } from '../tenant-job.js';
import { createDbReleaseStore, type DbReleaseStoreDeps } from './db-store.js';

const ORG = '0197a3c0-0000-7000-8000-000000000001';
const [OPEN, CLOSED, EMPTY] = [
  '0197a3c0-0000-7000-8000-0000000000a1',
  '0197a3c0-0000-7000-8000-0000000000a2',
  '0197a3c0-0000-7000-8000-0000000000a3',
];
const TUESDAY_10H = new Date('2026-11-03T03:00:00Z'); // in Ho Chi Minh City

// The SQL functions and `withTenant` are fakes that record the tenant each call runs under; the SQL runs against PostgreSQL in
// packages/db/test/after-hours-store.spec.ts and the whole release in test/after-hours-release.spec.ts.
function setup(transition: () => Promise<unknown> = () => Promise.resolve({ kind: 'changed' })) {
  const tenants: unknown[] = [];
  const pool = { query: vi.fn(), connect: vi.fn() } as unknown as DbPool;
  const hours = (ws: string) =>
    ws === CLOSED ? Array.from({ length: 7 }, () => null) : DEFAULT_WORKING_WEEK;
  const fns = {
    afterHoursHeldOrgs: vi.fn(() => Promise.resolve([ORG])),
    listWorkspaces: vi.fn(() => Promise.resolve([OPEN, CLOSED, EMPTY].map((id) => ({ id })))),
    afterHoursHeldConversations: vi.fn((_tx: TenantTx, ws: string) =>
      Promise.resolve(ws === EMPTY ? [] : [`c-${ws}`]),
    ),
    readWorkingWeek: vi.fn((_tx: TenantTx, ws: string) =>
      Promise.resolve({ timezone: 'Asia/Ho_Chi_Minh', week: hours(ws), isDefault: false }),
    ),
    listDaysOff: vi.fn(() => Promise.resolve([])),
  } as unknown as NonNullable<DbReleaseStoreDeps['fns']>;
  const inTransaction = vi.fn((_pool: DbPool, tenant: unknown, fn: (tx: TenantTx) => unknown) => {
    tenants.push(tenant);
    expect(currentTenantContext()).toEqual(tenant);
    return fn({} as TenantTx);
  }) as unknown as NonNullable<DbReleaseStoreDeps['inTransaction']>;
  const fsm = { transition: vi.fn(transition) };
  const store = createDbReleaseStore({
    pool,
    fsm: fsm as unknown as ConversationStateMachine,
    fns,
    inTransaction,
  });
  return { store, fns, pool, fsm, tenants };
}

describe('createDbReleaseStore', () => {
  it('asks for the organisations outside a tenant, the workspaces in the organisation, and the held ones of an open workspace in it', async () => {
    const t = setup();
    expect(await t.store.heldOrgs(7)).toEqual([ORG]);
    expect(vi.mocked(t.fns.afterHoursHeldOrgs)).toHaveBeenCalledWith(t.pool, 7);
    expect(await t.store.openWithHeld(ORG, TUESDAY_10H, 5)).toEqual([
      { workspaceId: OPEN, conversationIds: [`c-${OPEN}`] },
    ]);
    expect(vi.mocked(t.fns.afterHoursHeldConversations)).toHaveBeenCalledWith({}, OPEN, 5);
    // A workspace that holds nothing never reads its hours.
    expect(vi.mocked(t.fns.readWorkingWeek).mock.calls.map((c) => c[1])).toEqual([OPEN, CLOSED]);
    expect(t.tenants).toEqual([
      { orgId: ORG, workspaceIds: [] },
      ...[OPEN, CLOSED, EMPTY].map((ws) => ({ orgId: ORG, workspaceIds: [ws] })),
    ]);
  });

  it('releases a conversation (T08, actor system) in a tenant of its workspace; false when it is no longer held or contended', async () => {
    const t = setup();
    expect(await t.store.release(ORG, OPEN, 'c1')).toBe(true);
    expect(t.fsm.transition).toHaveBeenCalledWith(
      {},
      'c1',
      { type: 'release_after_hours', inHours: true },
      { actor: { kind: 'system' }, traceId: expect.any(String) as unknown },
    );
    expect(t.tenants).toEqual([{ orgId: ORG, workspaceIds: [OPEN] }]);
    for (const error of [
      new InvalidTransitionError('HUMAN_ACTIVE', 'release_after_hours', 'not_in_table'),
      new ConversationContendedError(3),
    ])
      expect(await setup(() => Promise.reject(error)).store.release(ORG, OPEN, 'c1')).toBe(false);
    expect(
      await setup(() => Promise.resolve({ kind: 'unchanged' })).store.release(ORG, OPEN, 'c1'),
    ).toBe(false);
    await expect(
      setup(() => Promise.reject(new Error('db'))).store.release(ORG, OPEN, 'c1'),
    ).rejects.toThrow('db');
  });

  it('refuses a call without a usable organisation before any transaction', async () => {
    const t = setup();
    await expect(t.store.release('', OPEN, 'c1')).rejects.toBeInstanceOf(JobTenantMissingError);
    expect(t.tenants).toEqual([]);
  });
});
