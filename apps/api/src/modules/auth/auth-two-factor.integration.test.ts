import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { afterAll, describe, expect, it } from 'vitest';

import { createAuth } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';
import { secretOf, totp } from './testing/totp.js';

// N86, N88: the whole life of a second factor on the real Drizzle adapter, as auth_role, on PostgreSQL. auth_role has no DELETE, so the
// whole run proves the plugin needs none. The two locks (users for the password, two_factors for the code) must not mix.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const BASE = 'http://localhost:3000';
const PW = randomBytes(18).toString('base64url');
const started = new Date();
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
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
const signIn = (email: string, password = PW) => post('/sign-in/email', { email, password });
const code = (res: Response, value: string) =>
  post('/two-factor/verify-totp', { code: value }, cookieOf(res));

async function enrolled() {
  const id = randomUUID();
  const email = `${id}@example.test`;
  users.push(id);
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [id, email],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), id, id, await hashPassword(PW)],
  );
  const first = await signIn(email);
  const enable = await post('/two-factor/enable', { password: PW }, cookieOf(first));
  const { totpURI, backupCodes } = (await enable.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  const secret = secretOf(totpURI);
  expect((await code(first, totp(secret))).status).toBe(200);
  return { id, email, secret, backupCodes };
}
const counters = async (id: string) =>
  (
    await admin.query<{ login: number; code: number; locked: boolean }>(
      `SELECT u.failed_login_count AS login, t.failed_verification_count AS code, t.locked_until IS NOT NULL AS locked
     FROM users u JOIN two_factors t ON t.user_id = u.id WHERE u.id = $1`,
      [id],
    )
  ).rows[0];

afterAll(async () => {
  const run = (text: string, params: unknown[]) => admin.query(text, params).catch(() => undefined);
  await run("DELETE FROM verifications WHERE created_at >= $1 AND identifier LIKE '2fa-%'", [
    started,
  ]);
  for (const t of ['two_factors', 'sessions', 'accounts'])
    await run(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [users]);
  await run('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  await Promise.all([authPool.end(), admin.end()]);
});

describe('a second factor under the grants of auth_role', () => {
  it('runs the whole life: confirm, sign in in two steps, read the session, use a backup code once', async () => {
    const u = await enrolled();
    const pw = await signIn(u.email);
    expect(((await pw.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const step = await code(pw, totp(u.secret));
    expect(step.status).toBe(200);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(step) }) });
    expect(session?.user.email).toBe(u.email);
    const backup = (own: Response) =>
      post('/two-factor/verify-backup-code', { code: u.backupCodes[0] }, cookieOf(own));
    expect((await backup(await signIn(u.email))).status).toBe(200);
    expect((await backup(await signIn(u.email))).status).toBe(401);
    const used = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM verifications WHERE used_at IS NOT NULL AND identifier LIKE '2fa-%' AND created_at >= $1",
      [started],
    );
    expect(used.rows[0]?.n).toBeGreaterThan(0);
  });

  it('locks the enrolment after 5 wrong codes, and the lock is kept in two_factors', async () => {
    const u = await enrolled();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await code(await signIn(u.email), i < 5 ? '000000' : totp(u.secret))).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(await counters(u.id)).toEqual({ login: 0, code: 5, locked: true });
  });

  it('keeps the two locks apart: wrong passwords count in users, wrong codes in two_factors, a right password clears only the first', async () => {
    const u = await enrolled();
    for (let i = 0; i < 3; i++) await signIn(u.email, `${PW}x`);
    expect(await counters(u.id)).toEqual({ login: 3, code: 0, locked: false });
    for (let i = 0; i < 2; i++) await code(await signIn(u.email), '000000');
    expect(await counters(u.id)).toEqual({ login: 0, code: 2, locked: false });
  });
});
