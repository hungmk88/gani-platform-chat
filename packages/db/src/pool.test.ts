import { afterEach, describe, expect, it } from 'vitest';

import {
  createDbPool,
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
} from './pool.js';

// The pool is lazy: nothing here connects. What reaches PostgreSQL is checked in test/pool-timeouts.spec.ts.
const URL = 'postgres://nobody@127.0.0.1:1/none';
const pools: ReturnType<typeof createDbPool>[] = [];
const make = (
  ...args: Parameters<typeof createDbPool> extends [string, ...infer R] ? R : never
) => {
  const pool = createDbPool(URL, ...args);
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe('createDbPool limits (review A-02)', () => {
  it('sets all three on every connection by default', () => {
    expect(make().options).toMatchObject({
      statement_timeout: DEFAULT_STATEMENT_TIMEOUT_MS,
      lock_timeout: DEFAULT_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
  });

  it('takes the values the caller gives, one by one', () => {
    const pool = make({
      statementTimeoutMs: 60_000,
      lockTimeoutMs: 100,
      idleInTransactionTimeoutMs: 7,
    });
    expect(pool.options).toMatchObject({
      statement_timeout: 60_000,
      lock_timeout: 100,
      idle_in_transaction_session_timeout: 7,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s: a limit of 0 would switch it off without anyone noticing',
    (bad) => {
      for (const key of [
        'statementTimeoutMs',
        'lockTimeoutMs',
        'idleInTransactionTimeoutMs',
      ] as const) {
        expect(() => createDbPool(URL, { [key]: bad })).toThrow(
          new RegExp(`${key} must be a whole number`),
        );
      }
    },
  );
});
