import type { createDbPool } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import { LOCK_MINUTES, loginLockout, MAX_FAILED_LOGINS } from './login-lockout.js';

// The logic around the three statements; the statements themselves (and the race) run on PostgreSQL in auth-flows.integration.test.ts.
const fake = (rows: unknown[] = []) => {
  const query = vi.fn(() => Promise.resolve({ rows }));
  return { query, lockout: loginLockout({ query } as unknown as ReturnType<typeof createDbPool>) };
};

describe('loginLockout', () => {
  it('says "not locked" without asking the database when the body has no email', async () => {
    const { lockout, query } = fake();
    for (const body of [undefined, null, {}, { email: 5 }])
      expect(await lockout.isLocked(body)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('says "locked" only when the database does, and "not locked" for an unknown address', async () => {
    expect(
      await fake([{ locked: true }]).lockout.isLocked({
        email: 'a@example.test',
        password: 'whatever-it-is',
      }),
    ).toBe(true);
    expect(await fake([{ locked: false }]).lockout.isLocked({ email: 'a@example.test' })).toBe(
      false,
    );
    expect(await fake([]).lockout.isLocked({ email: 'nobody@example.test' })).toBe(false);
  });

  it('counts a failure with the agreed limits and clears the count on success, only when there is an email', async () => {
    const { lockout, query } = fake();
    await lockout.failed({ email: 'a@example.test' });
    await lockout.succeeded({ email: 'a@example.test' });
    await lockout.failed({});
    await lockout.succeeded(null);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('failed_login_count + 1'), [
      'a@example.test',
      MAX_FAILED_LOGINS,
      LOCK_MINUTES,
    ]);
    expect([MAX_FAILED_LOGINS, LOCK_MINUTES]).toEqual([5, 30]);
  });
});
