import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { withAuthUser } from './auth-tx.js';

// The part that needs no database: a bad id is refused before a connection is taken. The rest is in test/auth-user-id.spec.ts.
describe('withAuthUser', () => {
  it.each(['x', '', "00000000-0000-0000-0000-000000000000'; DROP TABLE users"])(
    'rejects %j before touching the pool',
    async (id) => {
      const connect = vi.fn();
      const pool = { connect } as unknown as pg.Pool;
      const fn = vi.fn();
      await expect(withAuthUser(pool, id, fn)).rejects.toThrow(/userId/);
      expect(connect).not.toHaveBeenCalled();
      expect(fn).not.toHaveBeenCalled();
    },
  );
});
