import { randomBytes } from 'node:crypto';

import type { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';

import { buildAuthOptions } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';
import { revokingAdapter } from './revoking-adapter.js';
import { switchActiveOrg } from './switch-active-org.js';

// The plugin on the real Better Auth with the in-memory adapter; membership is a stub. The atomic swap against a parallel switch
// needs PostgreSQL and is in auth-flows.integration.test.ts.
const [A, B, OTHER] = [uuidv7(), uuidv7(), uuidv7()];
const BASE = 'http://localhost:3000';
const PW = randomBytes(18).toString('base64url');
type Row = Record<string, unknown>;

async function world(mustSetUp = false) {
  const db = {
    user: [] as Row[],
    session: [] as Row[],
    account: [] as Row[],
    verification: [] as Row[],
  };
  // Two kinds of question reach the pool: the rule about the second factor (one parameter) and the membership (two).
  const query = vi.fn((sql: string, params: unknown[]) =>
    Promise.resolve(
      sql.includes('is_platform_operator')
        ? { rows: [{ must: mustSetUp }] }
        : { rowCount: params[1] === A || params[1] === B ? 1 : 0 },
    ),
  );
  const env = loadAuthEnv({
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: BASE,
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  const pool = { query } as unknown as ReturnType<typeof createDbPool>;
  const auth = betterAuth(
    buildAuthOptions(env, revokingAdapter(memoryAdapter(db)), { plugins: [switchActiveOrg(pool)] }),
  );
  const [id, now] = [uuidv7(), new Date()];
  db.user.push({
    id,
    email: 'p@example.test',
    name: 'P',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  db.account.push({
    id: uuidv7(),
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword(PW),
    createdAt: now,
    updatedAt: now,
  });
  const res = await auth.api.signInEmail({
    body: { email: 'p@example.test', password: PW },
    asResponse: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const post = (orgId: unknown, as: string | null = cookie) =>
    auth.handler(
      new Request(`${BASE}/api/auth/switch-org`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: BASE,
          ...(as === null ? {} : { cookie: as }),
        },
        body: JSON.stringify({ orgId }),
      }),
    );
  const read = (c: string) => auth.api.getSession({ headers: new Headers({ cookie: c }) });
  return { db, post, read, cookie, query };
}
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('POST /switch-org', () => {
  it('moves the person to an organisation they belong to: new session with it, old one revoked, new cookie', async () => {
    const { db, post, read, cookie, query } = await world();
    const res = await post(A);
    expect(res.status).toBe(200);
    expect(db.session).toHaveLength(2);
    expect(db.session[0]?.['revokedAt']).toBeInstanceOf(Date);
    expect(db.session[1]).toMatchObject({ activeOrgId: A });
    expect(await read(cookie)).toBeNull();
    expect((await read(cookieOf(res)))?.session).toMatchObject({ activeOrgId: A });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('memberships_for_user'), [
      db.user[0]?.['id'],
      A,
    ]);
  });

  it('answers 200 and makes no new session for the organisation already active', async () => {
    const { db, post } = await world();
    const first = await post(A);
    const again = await post(A, cookieOf(first));
    expect(again.status).toBe(200);
    expect(db.session).toHaveLength(2);
  });

  it('refuses an organisation they do not belong to with the same 404, and a malformed id with 400, leaving the session alone', async () => {
    const { db, post, read, cookie } = await world();
    expect((await post(OTHER)).status).toBe(404);
    expect((await post('not-a-uuid')).status).toBe(400);
    expect((await post(undefined)).status).toBe(400);
    expect(db.session).toHaveLength(1);
    expect(await read(cookie)).not.toBeNull();
  });

  it('answers 403 two_factor_setup_required to a person who must set up a second factor, before looking at anything else', async () => {
    const { db, post, query } = await world(true);
    const res = await post(A);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'two_factor_setup_required' });
    expect((await post('not-a-uuid')).status).toBe(403);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('memberships_for_user($1) WHERE'),
      expect.anything(),
    );
    expect(db.session).toHaveLength(1);
  });

  it('needs a signed-in session', async () => {
    const { post } = await world();
    expect((await post(A, null)).status).toBe(401);
  });
});
