import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuth } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';

// N79, N83: Better Auth as it is really configured (createAuth), on the real Drizzle adapter, as auth_role, on PostgreSQL: sign-in,
// session read, sign-out and password change must work under auth_role's grants (no DELETE). Re-run it on every upgrade of better-auth.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
// Generated, never written down: nothing in this file looks like a credential.
const PASSWORD = randomBytes(18).toString('base64url');
const NEW_PASSWORD = randomBytes(18).toString('base64url');
const user = randomUUID();
// The person is an active member of one organisation, which sees the audit of a password change (N162).
const org = randomUUID();
const email = `${user}@example.test`;
const authPool = createDbPool(need('DATABASE_URL_AUTH'), { max: 3 });
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const env = loadAuthEnv({
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  BETTER_AUTH_URL: 'http://localhost:3000',
  APP_ENV: 'test',
  AUTH_ALLOW_HTTP: 'true',
});
const auth = createAuth({ pool: authPool, env });
// The sign-in limit counts per address: every sign-in comes from its own, so no test depends on how many ran before it.
const freshIp = () => [...randomBytes(4)].join('.');

const signIn = async (instance: typeof auth, password = PASSWORD) => {
  const res = await instance.api.signInEmail({
    body: { email, password },
    headers: new Headers({ 'x-forwarded-for': freshIp() }),
    asResponse: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { status: res.status, headers: new Headers({ cookie }) };
};
const rows = async () =>
  (
    await admin.query<{ revoked: boolean; hours: number }>(
      `SELECT revoked_at IS NOT NULL AS revoked, extract(epoch FROM expires_at - created_at)::float / 3600 AS hours
       FROM sessions WHERE user_id = $1 ORDER BY created_at`,
      [user],
    )
  ).rows;

beforeAll(async () => {
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'Test')`,
    [user, email],
  );
  await admin.query(
    // account_id is text and user_id is uuid: one parameter cannot serve both (42P08), so the id is passed twice.
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), user, user, await hashPassword(PASSWORD)],
  );
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    org,
    `t-${org}`,
    'T',
  ]);
  await admin.query(
    `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
    [randomUUID(), org, user],
  );
});

afterAll(async () => {
  for (const t of ['audit_logs', 'org_members'])
    await admin.query(`DELETE FROM ${t} WHERE org_id = $1`, [org]).catch(() => undefined);
  await admin.query('DELETE FROM organizations WHERE id = $1', [org]).catch(() => undefined);
  for (const t of ['sessions', 'accounts'])
    await admin.query(`DELETE FROM ${t} WHERE user_id = $1`, [user]).catch(() => undefined);
  await admin.query('DELETE FROM users WHERE id = $1', [user]).catch(() => undefined);
  await Promise.all([authPool.end(), admin.end()]);
});

describe('Better Auth on the real adapter, as auth_role', () => {
  it('signs in, creating a session of at most 12 hours that can be read back', async () => {
    const { status, headers } = await signIn(auth);
    expect(status).toBe(200);
    const [row] = await rows();
    expect(row?.revoked).toBe(false);
    expect(row?.hours).toBeLessThanOrEqual(12);
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe(email);
  });

  it('signs out by revoking: the row stays, revoked_at is set, and the session no longer reads', async () => {
    const { headers } = await signIn(auth);
    await auth.api.signOut({ headers });
    const all = await rows();
    expect(all.at(-1)?.revoked).toBe(true);
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it('changes the password and revokes the other sessions', async () => {
    const { headers } = await signIn(auth);
    const other = await signIn(auth);
    await auth.api.changePassword({
      headers,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true },
    });
    expect(await auth.api.getSession({ headers: other.headers })).toBeNull();
    expect((await signIn(auth, NEW_PASSWORD)).status).toBe(200);
    const stored = await admin.query<{ password: string }>(
      'SELECT password FROM accounts WHERE user_id = $1',
      [user],
    );
    expect(stored.rows[0]?.password).toMatch(/^\$argon2id\$/);
    const audited = await admin.query(
      'SELECT org_id, actor_user_id, action, target_id FROM audit_logs WHERE org_id = $1',
      [org],
    );
    expect(audited.rows).toEqual([
      { org_id: org, actor_user_id: user, action: 'user.password_changed', target_id: user },
    ]);
  });
});
