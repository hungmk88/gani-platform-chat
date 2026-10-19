import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { afterAll, describe, expect, it } from 'vitest';

import { createAuth } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';

// N85: lockout and organisation switch on the real Better Auth, PostgreSQL and auth_role. Every test makes its own people and
// organisations, so none depends on another. The parallel tests are the ones that need a real database.
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
const [users, orgs] = [[] as string[], [] as string[]];
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
async function newOrg(userId: string, status?: string) {
  const id = randomUUID();
  orgs.push(id);
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    id,
    `t-${id}`,
    'T',
  ]);
  if (status)
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', $4)`,
      [randomUUID(), id, userId, status],
    );
  return id;
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
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
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
  await run('DELETE FROM org_members WHERE user_id = ANY($1::uuid[])', users);
  await run('DELETE FROM organizations WHERE id = ANY($1::uuid[])', orgs);
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

// Review DB-01: a person whose users row is soft-deleted does not exist for sign-in, and a session they already had stops working.
describe('a soft-deleted person', () => {
  const remove = (id: string) =>
    admin.query('UPDATE users SET deleted_at = now() WHERE id = $1', [id]);

  it('cannot sign in, and is answered exactly as a wrong password and an unknown address', async () => {
    const [gone, other] = [await newUser(), await newUser()];
    await remove(gone.id);
    const answers = await Promise.all([
      signIn(gone.email),
      wrong(other.email),
      signIn(`${randomUUID()}@example.test`),
    ]);
    const texts = await Promise.all(answers.map((r) => r.text()));
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(new Set(texts).size).toBe(1);
  });

  it('loses a session made before the deletion: no session is read, and /switch-org answers 401', async () => {
    const u = await newUser();
    const org = await newOrg(u.id, 'active');
    const cookie = cookieOf(await signIn(u.email));
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    await remove(u.id);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect((await post('/switch-org', { orgId: org }, cookie)).status).toBe(401);
  });
});

describe('POST /switch-org', () => {
  const live = async (userId: string) =>
    (
      await admin.query<{ org: string | null }>(
        'SELECT active_org_id AS org FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at',
        [userId],
      )
    ).rows.map((r) => r.org);
  const total = async (userId: string) =>
    Number(
      (
        await admin.query<{ n: string }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [
          userId,
        ])
      ).rows[0]?.n,
    );

  it('moves to an organisation the person belongs to: a new session with it, the old one revoked, the old cookie dead', async () => {
    const u = await newUser();
    const [a, b] = [await newOrg(u.id, 'active'), await newOrg(u.id, 'active')];
    const first = cookieOf(await signIn(u.email));
    const res = await post('/switch-org', { orgId: a }, first);
    expect(res.status).toBe(200);
    expect(await live(u.id)).toEqual([a]);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: first }) })).toBeNull();
    const second = cookieOf(res);
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie: second }) }))?.session,
    ).toMatchObject({ activeOrgId: a });
    expect((await post('/switch-org', { orgId: a }, second)).status).toBe(200);
    expect(await total(u.id)).toBe(2);
    expect((await post('/switch-org', { orgId: b }, second)).status).toBe(200);
    expect(await live(u.id)).toEqual([b]);
  });

  it('refuses an organisation that is suspended, not theirs or malformed, and leaves the session as it was', async () => {
    const u = await newUser();
    const [suspended, stranger] = [await newOrg(u.id, 'suspended'), await newOrg(u.id)];
    const cookie = cookieOf(await signIn(u.email));
    expect((await post('/switch-org', { orgId: suspended }, cookie)).status).toBe(404);
    expect((await post('/switch-org', { orgId: stranger }, cookie)).status).toBe(404);
    expect((await post('/switch-org', { orgId: 'not-a-uuid' }, cookie)).status).toBe(400);
    expect(await live(u.id)).toEqual([null]);
    expect(await total(u.id)).toBe(1);
  });

  it('lets only one of two parallel switches from the same session win', async () => {
    const u = await newUser();
    const [a, b] = [await newOrg(u.id, 'active'), await newOrg(u.id, 'active')];
    const cookie = cookieOf(await signIn(u.email));
    const results = await Promise.all([
      post('/switch-org', { orgId: a }, cookie),
      post('/switch-org', { orgId: b }, cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await live(u.id)).toHaveLength(1);
  });
});
