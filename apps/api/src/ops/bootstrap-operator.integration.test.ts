import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { afterAll, describe, expect, it } from 'vitest';

import { verifyPassword } from '../modules/auth/password.js';
import { BootstrapRefusedError, bootstrapPlatformOperator } from './bootstrap-operator.js';

// The bootstrap of the first platform operator (N25, N148) on PostgreSQL as migration_role. Everything happens in ONE transaction that
// is rolled back: other test files make operators of their own at the same time, so this one first takes the flag off them inside its
// transaction (nobody else sees that), and leaves the database as it found it.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const pool = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 1 });
const PASSWORD = 'correct horse 42 battery';
const input = (email: string) => ({ email, password: PASSWORD, displayName: 'Ops' });
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => 'made',
    (e: unknown) => (e instanceof BootstrapRefusedError ? e.reason : e),
  );

afterAll(() => pool.end());

describe('bootstrapPlatformOperator', () => {
  it('makes one active operator who can sign in with the password, then refuses every other run', async () => {
    const client = await pool.connect();
    const email = `${uuidv7()}@example.test`;
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE users SET is_platform_operator = false WHERE is_platform_operator',
      );
      const ids = { userId: uuidv7(), accountId: uuidv7() };
      expect(await bootstrapPlatformOperator(client, input(email), ids)).toBe(ids.userId);
      const { rows } = await client.query(
        `SELECT u.email, u.status, u.is_platform_operator, u.email_verified_at IS NOT NULL AS verified, u.two_factor_enabled,
                a.account_id, a.password
         FROM users u JOIN accounts a ON a.user_id = u.id WHERE u.id = $1`,
        [ids.userId],
      );
      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        email,
        status: 'active',
        is_platform_operator: true,
        verified: true,
        two_factor_enabled: false,
        account_id: ids.userId,
      });
      expect(await verifyPassword({ hash: String(row['password']), password: PASSWORD })).toBe(
        true,
      );
      const again = { userId: uuidv7(), accountId: uuidv7() };
      expect(
        await refusal(bootstrapPlatformOperator(client, input(`${uuidv7()}@example.test`), again)),
      ).toBe('operator_exists');
      // With no operator left but the email in use, it refuses too.
      await client.query('UPDATE users SET is_platform_operator = false WHERE id = $1', [
        ids.userId,
      ]);
      expect(await refusal(bootstrapPlatformOperator(client, input(email), again))).toBe(
        'email_taken',
      );
      const count = await client.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [
        again.userId,
      ]);
      expect(count.rows[0]).toEqual({ n: 0 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('the script', () => {
  it('refuses an environment that does not say what it is, naming the reason and never the person', () => {
    const script = fileURLToPath(
      new URL('../../scripts/bootstrap-platform-operator.mjs', import.meta.url),
    );
    const run = spawnSync(process.execPath, [script], {
      env: {
        PATH: process.env['PATH'] ?? '',
        BOOTSTRAP_OPERATOR_EMAIL: 'secret-person@example.test',
        BOOTSTRAP_OPERATOR_PASSWORD: PASSWORD,
      },
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout.trim())).toMatchObject({
      event: 'platform_operator_bootstrap_refused',
      reason: 'app_env_missing',
    });
    expect(run.stdout + run.stderr).not.toMatch(/secret-person|correct horse/);
  });
});
