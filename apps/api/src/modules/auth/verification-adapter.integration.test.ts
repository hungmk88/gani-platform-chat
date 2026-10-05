import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { afterAll, describe, expect, it } from 'vitest';

import { createAuth } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';

// N87: a one-time token, on the real adapter, as auth_role, on PostgreSQL. Consuming it is a claim, UPDATE ... WHERE id AND used_at
// IS NULL, so of several requests for the same token exactly one must win. If two ever win, a code works twice: that is a security
// failure, not a flaky test. Re-run it on every upgrade of better-auth.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const authPool = createDbPool(need('DATABASE_URL_AUTH'), { max: 8 });
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const env = loadAuthEnv({
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  BETTER_AUTH_URL: 'http://localhost:3000',
  APP_ENV: 'test',
  AUTH_ALLOW_HTTP: 'true',
});
const auth = createAuth({ pool: authPool, env });
const made: string[] = [];
const identifier = () => {
  const id = `n87-${randomUUID()}`;
  made.push(id);
  return id;
};
const inMinutes = (n: number) => new Date(Date.now() + n * 60_000);
const adapter = async () => (await auth.$context).internalAdapter;
const create = async (id: string) =>
  (await adapter()).createVerificationValue({
    identifier: id,
    value: 'payload',
    expiresAt: inMinutes(10),
  });
const used = async (id: string) =>
  (
    await admin.query<{ used: boolean }>(
      'SELECT used_at IS NOT NULL AS used FROM verifications WHERE identifier = $1 ORDER BY created_at',
      [id],
    )
  ).rows.map((r) => r.used);

afterAll(async () => {
  await admin
    .query('DELETE FROM verifications WHERE identifier = ANY($1::text[])', [made])
    .catch(() => undefined);
  await Promise.all([authPool.end(), admin.end()]);
});

describe('a one-time token on the real adapter', () => {
  it('is read, consumed once and then gone, while its row stays marked used', async () => {
    const [id, ia] = [identifier(), await adapter()];
    await create(id);
    expect((await ia.findVerificationValue(id))?.value).toBe('payload');
    expect((await ia.consumeVerificationValue(id))?.value).toBe('payload');
    expect(await ia.consumeVerificationValue(id)).toBeNull();
    expect(await ia.findVerificationValue(id)).toBeNull();
    expect(await used(id)).toEqual([true]);
  });

  it('is claimed by exactly one of several requests that arrive together (repeated, fresh token each time)', async () => {
    const ia = await adapter();
    for (let round = 0; round < 10; round++) {
      const id = identifier();
      await create(id);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => ia.consumeVerificationValue(id)),
      );
      expect(results.filter(Boolean), `round ${round}`).toHaveLength(1);
      expect(await used(id)).toEqual([true]);
    }
  });

  it('does not delete an expired row when another is read (the cleanup of the library is off)', async () => {
    const [stale, fresh, ia] = [identifier(), identifier(), await adapter()];
    // Made by the admin: a row that already expired when it was written would break expires_at > created_at.
    await admin.query(
      `INSERT INTO verifications (id, identifier, value, created_at, expires_at)
       VALUES ($1, $2, 'payload', now() - interval '2 hours', now() - interval '5 minutes')`,
      [randomUUID(), stale],
    );
    await create(fresh);
    expect((await ia.findVerificationValue(fresh))?.value).toBe('payload');
    expect(await used(stale)).toEqual([false]);
  });

  it('cannot be deleted by auth_role at all (42501): the wrapper is not what keeps the rows', async () => {
    await expect(authPool.query('DELETE FROM verifications WHERE false')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
