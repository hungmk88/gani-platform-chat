import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { afterAll, describe, expect, it } from 'vitest';

import { createAuth } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';

// N85: the account lock on the real Better Auth, PostgreSQL and auth_role. Every test makes its own person, so none depends on
// another. The parallel test is the one that needs a real database.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const BASE = 'http://localhost:3000';
const PW = randomBytes(18).toString('base64url');
const authPool = createDbPool(need('DATABASE_URL_AUTH'), { max: 8 });
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const env = loadAuthEnv({
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  BETTER_AUTH_URL: BASE,
  APP_ENV: 'test',
  AUTH_ALLOW_HTTP: 'true',
});
const auth = createAuth({ pool: authPool, env });
const users: string[] = [];
const freshIp = () => [...randomBytes(4)].join('.');

async function newUser() {
  const id = randomUUID();
  users.push(id);
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [id, `${id}@example.test`],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), id, id, await hashPassword(PW)],
  );
  return { id, email: `${id}@example.test` };
}
const post = (path: string, body: object, cookie?: string) =>
  auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        'x-forwarded-for': freshIp(),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const signIn = (email: string, password = PW) => post('/sign-in/email', { email, password });
const wrong = (email: string) => signIn(email, `${PW}x`);
const state = async (id: string) =>
  (
    await admin.query<{
      failed: number;
      locked: boolean;
      mins: number | null;
      status: string;
      verified: Date | null;
    }>(
      `SELECT failed_login_count AS failed, locked_until IS NOT NULL AS locked, (extract(epoch FROM locked_until - now()) / 60)::float8 AS mins,
            status, email_verified_at AS verified FROM users WHERE id = $1`,
      [id],
    )
  ).rows[0];
const lock = async (email: string) => {
  for (let i = 0; i < 5; i++) await wrong(email);
};

afterAll(async () => {
  const run = (text: string, ids: string[]) => admin.query(text, [ids]).catch(() => undefined);
  await run('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', users);
  await run('DELETE FROM accounts WHERE user_id = ANY($1::uuid[])', users);
  await run('DELETE FROM users WHERE id = ANY($1::uuid[])', users);
  await Promise.all([authPool.end(), admin.end()]);
});

describe('the account lock', () => {
  it('locks for 30 minutes after 5 wrong passwords, and the status trigger stays out of it', async () => {
    const u = await newUser();
    const before = await state(u.id);
    for (let i = 0; i < 5; i++) expect((await wrong(u.email)).status).toBe(401);
    const after = await state(u.id);
    expect(after).toMatchObject({ failed: 5, locked: true });
    expect(after?.mins).toBeGreaterThan(29);
    expect(after?.mins).toBeLessThanOrEqual(30);
    expect([after?.status, after?.verified]).toEqual([before?.status, before?.verified]);
  });

  it('answers a locked account, even with the right password, exactly as it answers a wrong password and an unknown address', async () => {
    const u = await newUser();
    await lock(u.email);
    const answers = await Promise.all([
      signIn(u.email),
      wrong(u.email),
      signIn(`${randomUUID()}@example.test`),
    ]);
    const texts = await Promise.all(answers.map((r) => r.text()));
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(new Set(texts).size).toBe(1);
  });

  it('is not extended by attempts made while it holds', async () => {
    const u = await newUser();
    await lock(u.email);
    const before = await admin.query('SELECT locked_until FROM users WHERE id = $1', [u.id]);
    for (let i = 0; i < 3; i++) await wrong(u.email);
    expect(
      (await admin.query('SELECT locked_until FROM users WHERE id = $1', [u.id])).rows,
    ).toEqual(before.rows);
  });

  it('ends: after it expires the right password signs in and the count starts again from 0', async () => {
    const u = await newUser();
    await lock(u.email);
    await admin.query(`UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1`, [
      u.id,
    ]);
    expect((await signIn(u.email)).status).toBe(200);
    expect(await state(u.id)).toMatchObject({ failed: 0, locked: false });
  });

  it('forgets earlier failures after a successful sign-in', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await wrong(u.email);
    expect((await state(u.id))?.failed).toBe(3);
    expect((await signIn(u.email)).status).toBe(200);
    expect((await state(u.id))?.failed).toBe(0);
  });

  it('counts every one of several wrong attempts that run at the same time', async () => {
    const u = await newUser();
    await Promise.all([1, 2, 3, 4].map(() => wrong(u.email)));
    expect((await state(u.id))?.failed).toBe(4);
  });
});
