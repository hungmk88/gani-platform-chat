import { randomBytes, randomUUID } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';
import { authSchema, createAuthDb, createDbPool } from '@gani/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { revokingAdapter } from './revoking-adapter.js';

// N79: Better Auth on the real Drizzle adapter, as auth_role, on PostgreSQL: sign-in, session read, sign-out and password change
// must work under auth_role's grants (no DELETE). Re-run it on every upgrade of better-auth.
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
const email = `${user}@example.test`;
const authPool = createDbPool(need('DATABASE_URL_AUTH'), { max: 3 });
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });

const options = {
  baseURL: 'http://localhost:3000',
  secret: randomBytes(32).toString('hex'),
  emailAndPassword: {
    enabled: true,
    password: {
      hash: (p: string) => hash(p),
      verify: ({ hash: h, password }: { hash: string; password: string }) => verify(h, password),
    },
  },
  session: {
    expiresIn: 12 * 3600,
    disableSessionRefresh: true,
    additionalFields: {
      revokedAt: { type: 'date', required: false, input: false },
      activeOrgId: { type: 'string', required: false, input: false },
    },
  },
  advanced: { database: { generateId: () => randomUUID() } },
  // The hook 6c-2b will use: nothing about the caller is stored (sessions_ip_address_check allows only NULL or ''). Better Auth
  // writes 127.0.0.1 when it has no address, and the user agent header when there is one.
  databaseHooks: {
    session: {
      create: {
        before: (session: Record<string, unknown>) =>
          Promise.resolve({ data: { ...session, ipAddress: '', userAgent: '' } }),
      },
    },
  },
  telemetry: { enabled: false },
} as const;
const adapter = drizzleAdapter(createAuthDb(authPool), {
  provider: 'pg',
  schema: authSchema,
  usePlural: true,
});
const auth = betterAuth({ ...options, database: revokingAdapter(adapter) });

const signIn = async (instance: typeof auth, password = PASSWORD) => {
  const res = await instance.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = (res.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
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
    [randomUUID(), user, user, await hash(PASSWORD)],
  );
});

afterAll(async () => {
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
  });
});
