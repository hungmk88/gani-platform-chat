import { describe, expect, it, vi } from 'vitest';

import { createDbPartitionStore, type DbPool } from './db-store.js';

// The SQL functions are fakes that record what they are given: the store passes the pool and the arguments on, and nothing else.
// The functions run against PostgreSQL in packages/db (partitions-ensure.spec.ts, partitions-default-rows.spec.ts).
function setup() {
  const pool = { marker: 'pool' } as unknown as DbPool;
  const fns = {
    ensureLogPartitions: vi.fn(() =>
      Promise.resolve([{ parent: 'audit_logs', created: 1, blockedMonths: [] }]),
    ),
    purgeInboundEventKeys: vi.fn(() => Promise.resolve(7)),
    defaultPartitionRows: vi.fn(() => Promise.resolve([{ parent: 'messages', rowsCapped: 2 }])),
  };
  return { pool, fns, store: createDbPartitionStore({ pool, fns }) };
}

describe('createDbPartitionStore', () => {
  it('makes the months with the pool and the number it is given', async () => {
    const { pool, fns, store } = setup();
    expect(await store.ensure(3)).toEqual([
      { parent: 'audit_logs', created: 1, blockedMonths: [] },
    ]);
    expect(fns.ensureLogPartitions).toHaveBeenCalledWith(pool, 3);
  });

  it('purges the keys with the retention and the batch, and returns how many went', async () => {
    const { pool, fns, store } = setup();
    expect(await store.purgeKeys(35, 10_000)).toBe(7);
    expect(fns.purgeInboundEventKeys).toHaveBeenCalledWith(pool, 35, 10_000);
  });

  it('reads the DEFAULT rows with the pool, and nothing else', async () => {
    const { pool, fns, store } = setup();
    expect(await store.defaultRows()).toEqual([{ parent: 'messages', rowsCapped: 2 }]);
    expect(fns.defaultPartitionRows).toHaveBeenCalledWith(pool);
  });

  it('is built on the real functions when none are given', () => {
    const store = createDbPartitionStore({ pool: {} as unknown as DbPool });
    expect(Object.keys(store).sort()).toEqual(['defaultRows', 'ensure', 'purgeKeys']);
  });
});
