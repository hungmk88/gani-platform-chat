import type { createDbPool } from '@gani/db';
import { describe, expect, it, vi } from 'vitest';

import {
  isSetupRoute,
  mustSetUpTwoFactor,
  requiresTwoFactor,
  TWO_FACTOR_SETUP_ROUTES,
} from './two-factor.js';

// The questions around the two statements; the statements themselves (roles, memberships, suspended ones) run on PostgreSQL in
// auth-two-factor.integration.test.ts.
const fake = (rows: unknown[]) => {
  const query = vi.fn(() => Promise.resolve({ rows }));
  return { query, pool: { query } as unknown as ReturnType<typeof createDbPool> };
};

describe('requiresTwoFactor and mustSetUpTwoFactor', () => {
  it('ask about the person, and read a yes only when the database says yes', async () => {
    const { pool, query } = fake([{ required: true, must: true }]);
    expect(await requiresTwoFactor(pool, 'u1')).toBe(true);
    expect(await mustSetUpTwoFactor(pool, 'u1')).toBe(true);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('memberships_for_user'), [
      'u1',
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('two_factor_enabled'), ['u1']);
    const no = fake([{ required: false, must: false }]);
    expect(await requiresTwoFactor(no.pool, 'u1')).toBe(false);
    expect(await mustSetUpTwoFactor(no.pool, 'u1')).toBe(false);
  });

  it('say "not required" for a person who is not there or was deleted', async () => {
    const { pool } = fake([]);
    expect(await requiresTwoFactor(pool, 'gone')).toBe(false);
    expect(await mustSetUpTwoFactor(pool, 'gone')).toBe(false);
  });
});

describe('the setup routes', () => {
  it('are the four of N86, and only they are setup routes', () => {
    expect([...TWO_FACTOR_SETUP_ROUTES]).toEqual([
      '/two-factor/enable',
      '/two-factor/verify-totp',
      '/two-factor/generate-backup-codes',
      '/sign-out',
    ]);
    for (const path of TWO_FACTOR_SETUP_ROUTES) expect(isSetupRoute(path)).toBe(true);
    for (const path of [
      '/switch-org',
      '/two-factor/get-totp-uri',
      '/get-session',
      '/sign-in/email',
      '',
    ]) {
      expect(isSetupRoute(path), path).toBe(false);
    }
  });
});
