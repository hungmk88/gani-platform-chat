import { uuidv7 } from '@gani/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sqlState, url } from './db.js';
import { cleanupTenant, seedTenant } from './fixtures.js';

// PR6c-3a (N86): the two counters the 2FA plugin of Better Auth reads and writes on every verification.
const org = uuidv7();
let user = '';
let admin: pg.Client;
let auth: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: url('migration') });
  auth = new pg.Client({ connectionString: url('auth') });
  await Promise.all([admin.connect(), auth.connect()]);
  user = await seedTenant(admin, org);
  await auth.query(
    "INSERT INTO two_factors (id, user_id, secret, backup_codes) VALUES ($1, $2, 's', 'c')",
    [uuidv7(), user],
  );
});

afterAll(async () => {
  await auth.end();
  await admin.query('DELETE FROM two_factors WHERE user_id = $1', [user]).catch(() => undefined);
  await cleanupTenant(admin, org, user);
  await admin.end();
});

const row = async () =>
  (
    await auth.query<{ n: number; locked: boolean }>(
      'SELECT failed_verification_count AS n, locked_until IS NOT NULL AS locked FROM two_factors WHERE user_id = $1',
      [user],
    )
  ).rows[0];

describe('two_factors.failed_verification_count and locked_until', () => {
  it('start at 0 and not locked', async () => {
    expect(await row()).toEqual({ n: 0, locked: false });
  });

  it('can be counted up and locked by auth_role, as the plugin does, and cleared again', async () => {
    const up = await auth.query<{ n: number }>(
      'UPDATE two_factors SET failed_verification_count = failed_verification_count + 1 WHERE user_id = $1 RETURNING failed_verification_count AS n',
      [user],
    );
    expect(up.rows[0]?.n).toBe(1);
    await auth.query(
      "UPDATE two_factors SET locked_until = now() + interval '30 minutes' WHERE user_id = $1",
      [user],
    );
    expect(await row()).toEqual({ n: 1, locked: true });
    await auth.query(
      'UPDATE two_factors SET failed_verification_count = 0, locked_until = NULL WHERE user_id = $1 AND locked_until IS NOT NULL',
      [user],
    );
    expect(await row()).toEqual({ n: 0, locked: false });
  });

  it('refuse a negative count (23514) and still do not let auth_role move the enrolment to another person (42501)', async () => {
    const negative = auth.query(
      'UPDATE two_factors SET failed_verification_count = -1 WHERE user_id = $1',
      [user],
    );
    expect(await sqlState(negative)).toBe('23514');
    expect(await sqlState(auth.query('UPDATE two_factors SET user_id = user_id'))).toBe('42501');
  });
});
