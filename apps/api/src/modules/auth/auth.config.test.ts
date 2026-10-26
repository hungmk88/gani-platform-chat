import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { twoFactor } from 'better-auth/plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthOptions } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';
import { revokingAdapter } from './revoking-adapter.js';
import { secretOf, totp } from './testing/totp.js';

// The whole configuration on the real Better Auth with the in-memory adapter (no database). The rate limiter keeps its counters per
// process, not per instance, so every test uses its own address (N83). The same configuration runs on PostgreSQL in
// auth-adapter.integration.test.ts.
type Row = Record<string, unknown>;
type Options = BetterAuthOptions;
const HTTP = 'http://localhost:3000';
const HTTPS = 'https://app.example.test';
const EMAIL = 'person@example.test';
const PW = randomBytes(18).toString('base64url');
const PW2 = randomBytes(18).toString('base64url');
const freshIp = () => [...randomBytes(4)].join('.');

async function world(
  url = HTTP,
  tweak: (o: Options) => Options = (o) => o,
  extras: Parameters<typeof buildAuthOptions>[2] = {},
) {
  const env = loadAuthEnv({
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: url,
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  const db = {
    user: [] as Row[],
    session: [] as Row[],
    account: [] as Row[],
    verification: [] as Row[],
    twoFactor: [] as Row[],
  };
  const built: Options = buildAuthOptions(env, revokingAdapter(memoryAdapter(db)), extras);
  const options = tweak(built);
  const userId = uuidv7();
  const now = new Date();
  db.user.push({
    id: userId,
    email: EMAIL,
    name: 'T',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  const password = await hashPassword(PW);
  db.account.push({
    id: uuidv7(),
    userId,
    accountId: userId,
    providerId: 'credential',
    password,
    createdAt: now,
    updatedAt: now,
  });
  return { db, userId, options, auth: betterAuth(options) };
}
type Auth = Awaited<ReturnType<typeof world>>['auth'];

const signIn = (auth: Auth, o: { ip?: string; ua?: string; rememberMe?: boolean } = {}) =>
  auth.api.signInEmail({
    body: { email: EMAIL, password: PW, rememberMe: o.rememberMe },
    headers: new Headers({
      'x-forwarded-for': o.ip ?? freshIp(),
      'user-agent': o.ua ?? 'Test/1.0',
    }),
    asResponse: true,
  });
const cookie = (res: Response) =>
  new Headers({
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  });
const call = (
  auth: Auth,
  url: string,
  path: string,
  method = 'POST',
  body: object = {},
  as?: string,
) =>
  auth.handler(
    new Request(`${url}/api/auth${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: url,
        'x-forwarded-for': freshIp(),
        ...(as ? { cookie: as } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    }),
  );
const change = (auth: Auth, from: Response) =>
  auth.api.changePassword({
    headers: cookie(from),
    body: { currentPassword: PW, newPassword: PW2, revokeOtherSessions: true },
  });

afterEach(() => vi.useRealTimers());

describe('closed doors', () => {
  it('sign-up gives 404 over HTTP and 400 for a server-side call, and makes no user', async () => {
    const { auth, db } = await world();
    expect((await call(auth, HTTP, '/sign-up/email')).status).toBe(404);
    await expect(
      auth.api.signUpEmail({ body: { email: 'x@example.test', password: PW, name: 'X' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.user).toHaveLength(1);
  });

  it.each([
    ['POST', '/sign-up/email'],
    ['GET', '/verify-email'],
    ['POST', '/update-user'],
    ['POST', '/update-session'],
    ['POST', '/send-verification-email'],
    ['POST', '/reset-password'],
    ['POST', '/request-password-reset'],
    ['GET', '/reset-password/sometoken'],
    ['POST', '/two-factor/disable'],
    ['POST', '/two-factor/send-otp'],
    ['POST', '/two-factor/verify-otp'],
  ])(
    '%s %s is 404, and is not 404 once disabledPaths is emptied (so the 404 is ours)',
    async (method, path) => {
      const shut = await world();
      const open = await world(HTTP, (o) => ({ ...o, disabledPaths: [], hooks: {} }));
      expect((await call(shut.auth, HTTP, path, method)).status).toBe(404);
      expect((await call(open.auth, HTTP, path, method)).status).not.toBe(404);
    },
  );

  it('keeps telemetry off', async () => {
    const { options } = await world();
    expect(options.telemetry?.enabled).toBe(false);
  });
});

describe('the session and its cookie', () => {
  it('http on a developer machine: Max-Age 43200, HttpOnly, SameSite=Lax, no Secure and no prefix', async () => {
    const { auth } = await world(HTTP);
    const set =
      (await signIn(auth)).headers.getSetCookie().find((c) => c.includes('session_token')) ?? '';
    expect(set).toMatch(/^better-auth\.session_token=/);
    for (const part of ['Max-Age=43200', 'HttpOnly', 'SameSite=Lax']) expect(set).toContain(part);
    expect(set).not.toContain('Secure');
  });

  it('https: the __Secure- prefix and Secure come by themselves', async () => {
    const { auth } = await world(HTTPS);
    const set =
      (await signIn(auth)).headers.getSetCookie().find((c) => c.includes('session_token')) ?? '';
    expect(set).toMatch(/^__Secure-better-auth\.session_token=/);
    for (const part of ['Max-Age=43200', 'HttpOnly', 'Secure', 'SameSite=Lax'])
      expect(set).toContain(part);
  });

  it('every way of starting a session stores no address, no user agent and at most 12 hours', async () => {
    const { auth, db } = await world();
    await signIn(auth);
    await signIn(auth, { rememberMe: false });
    const own = await signIn(auth, { ip: '203.0.113.9', ua: 'Mozilla/5.0' });
    await change(auth, own);
    expect(db.session).toHaveLength(4);
    for (const row of db.session) {
      expect([row['ipAddress'], row['userAgent']]).toEqual(['', '']);
      expect(
        (+(row['expiresAt'] as Date) - +(row['createdAt'] as Date)) / 3.6e6,
      ).toBeLessThanOrEqual(12);
    }
  });

  it('gives sessions an id from the UUIDv7 generator', async () => {
    const { auth, db } = await world();
    await signIn(auth);
    expect(db.session[0]?.['id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    [true, false],
    [false, true],
  ])(
    'disableSessionRefresh=%s: after 2 hours the stored expiry moves = %s',
    async (disable, moves) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-05T08:00:00Z'));
      const { auth, db } = await world(HTTP, (o) => ({
        ...o,
        session: { ...o.session, updateAge: 3600, disableSessionRefresh: disable },
      }));
      const res = await signIn(auth);
      const before = +(db.session[0]?.['expiresAt'] as Date);
      vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
      await auth.api.getSession({ headers: cookie(res) });
      expect(+(db.session[0]?.['expiresAt'] as Date) !== before).toBe(moves);
    },
  );

  it('signing out revokes: the row stays with revokedAt, the session no longer reads', async () => {
    const { auth, db } = await world();
    const res = await signIn(auth);
    await auth.api.signOut({ headers: cookie(res) });
    expect(db.session).toHaveLength(1);
    expect(db.session[0]?.['revokedAt']).toBeInstanceOf(Date);
    expect(await auth.api.getSession({ headers: cookie(res) })).toBeNull();
  });
});

describe('passwords', () => {
  it('a change ends the other sessions of the person, wherever they signed in, and the hash is Argon2id', async () => {
    const { auth, db } = await world();
    const [here, there] = [
      await signIn(auth, { ip: freshIp() }),
      await signIn(auth, { ip: freshIp() }),
    ];
    await change(auth, here);
    expect(await auth.api.getSession({ headers: cookie(there) })).toBeNull();
    expect(db.account[0]?.['password']).toMatch(/^\$argon2id\$/);
  });

  it.each([
    [true, 0],
    [false, 2],
  ])(
    'revokeSessionsOnPasswordReset=%s leaves %s of 2 sessions alive after a reset',
    async (on, alive) => {
      const { auth, db, userId } = await world(HTTP, (o) => ({
        ...o,
        emailAndPassword: {
          enabled: true,
          ...o.emailAndPassword,
          revokeSessionsOnPasswordReset: on,
        },
      }));
      const sessions = [
        await signIn(auth, { ip: freshIp() }),
        await signIn(auth, { ip: freshIp() }),
      ];
      const token = randomBytes(16).toString('hex');
      const now = new Date();
      db.verification.push({
        id: uuidv7(),
        identifier: `reset-password:${token}`,
        value: userId,
        expiresAt: new Date(+now + 3.6e6),
        createdAt: now,
        updatedAt: now,
      });
      await auth.api.resetPassword({ body: { token, newPassword: PW2 } });
      const reads = await Promise.all(
        sessions.map((s) => auth.api.getSession({ headers: cookie(s) })),
      );
      expect(reads.filter(Boolean)).toHaveLength(alive);
    },
  );
});

describe('the sign-in limit', () => {
  it('answers 429 from the 11th wrong attempt of one address, and not for another', async () => {
    const { auth } = await world();
    const attempt = (ip: string) =>
      auth.handler(
        new Request(`${HTTP}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: HTTP, 'x-forwarded-for': ip },
          body: JSON.stringify({ email: EMAIL, password: `${PW}x` }),
        }),
      );
    const ip = freshIp();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt(ip)).status);
    expect(codes).toEqual([...Array<number>(10).fill(401), 429]);
    expect((await attempt(freshIp())).status).toBe(401);
  });
});

describe('two-factor', () => {
  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
  const hasSession = (res: Response) =>
    res.headers.getSetCookie().some((c) => /session_token=[^;]+/.test(c));
  const verify = (auth: Auth, from: Response, code: string, extra: object = {}) =>
    call(auth, HTTP, '/two-factor/verify-totp', 'POST', { code, ...extra }, cookieOf(from));

  const rekey = (o: Options, secrets: { version: number; value: string }[]) => {
    const next: Options = { ...o, secrets };
    return betterAuth(next);
  };

  async function enrolled(tweak?: (o: Options) => Options) {
    const w = await world(HTTP, tweak);
    const first = await signIn(w.auth);
    const enable = await call(
      w.auth,
      HTTP,
      '/two-factor/enable',
      'POST',
      { password: PW },
      cookieOf(first),
    );
    const { totpURI, backupCodes } = (await json(enable)) as {
      totpURI: string;
      backupCodes: string[];
    };
    const secret = secretOf(totpURI);
    return { ...w, secret, backupCodes, first, enable };
  }

  it('enabling makes no session; the first correct code confirms it, makes a new session and revokes the old one', async () => {
    const { auth, db, secret, first } = await enrolled();
    expect(db.session).toHaveLength(1);
    expect(db.twoFactor[0]?.['verified']).toBe(false);
    expect((await verify(auth, first, totp(secret))).status).toBe(200);
    expect(db.session).toHaveLength(2);
    expect(db.session[0]?.['revokedAt']).toBeInstanceOf(Date);
    expect(db.user[0]?.['twoFactorEnabled']).toBe(true);
    expect(db.twoFactor[0]?.['verified']).toBe(true);
  });

  it('keeps the secret and the backup codes encrypted under the versioned key', async () => {
    const { db } = await enrolled();
    expect(db.twoFactor[0]?.['secret']).toMatch(/^\$ba\$1\$/);
    expect(db.twoFactor[0]?.['backupCodes']).toMatch(/^\$ba\$1\$/);
  });

  it('asks for the code after the password and gives the session only for the code', async () => {
    const { auth, secret, first } = await enrolled();
    await verify(auth, first, totp(secret));
    const password = await signIn(auth);
    expect((await json(password))['twoFactorRedirect']).toBe(true);
    expect(hasSession(password)).toBe(false);
    const step = await verify(auth, password, totp(secret));
    expect(step.status).toBe(200);
    expect(hasSession(step)).toBe(true);
  });

  it('accepts a backup code once', async () => {
    const { auth, secret, first, backupCodes } = await enrolled();
    await verify(auth, first, totp(secret));
    const use = async () =>
      call(
        auth,
        HTTP,
        '/two-factor/verify-backup-code',
        'POST',
        { code: backupCodes[0] },
        cookieOf(await signIn(auth)),
      );
    expect((await use()).status).toBe(200);
    expect((await use()).status).toBe(401);
  });

  it('locks the enrolment after 5 wrong codes: the 6th, even the right one, is 429', async () => {
    const { auth, db, secret, first } = await enrolled();
    await verify(auth, first, totp(secret));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await verify(auth, await signIn(auth), i < 5 ? '000000' : totp(secret))).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(db.twoFactor[0]?.['failedVerificationCount']).toBe(5);
    expect(db.twoFactor[0]?.['lockedUntil']).toBeInstanceOf(Date);
  });

  // Control: with the plugin's own default the cookie of "trust this device" lets the next sign-in in without a code.
  it.each([
    ['as configured (trustDeviceMaxAge 0)', undefined, true],
    [
      'with the library default (30 days): the way round',
      (o: Options) => ({ ...o, plugins: [twoFactor({ issuer: 'Gani' })] }),
      false,
    ],
  ])('trust this device %s: the code is asked again = %s', async (_label, tweak, asksAgain) => {
    const { auth, secret, first } = await enrolled(tweak);
    await verify(auth, first, totp(secret));
    const trusted = await verify(auth, await signIn(auth), totp(secret), { trustDevice: true });
    const trust = trusted.headers
      .getSetCookie()
      .find((c) => c.startsWith('better-auth.trust_device='));
    const again = await auth.api.signInEmail({
      body: { email: EMAIL, password: PW },
      headers: new Headers({ cookie: trust?.split(';')[0] ?? '', 'x-forwarded-for': freshIp() }),
      asResponse: true,
    });
    expect((await json(again))['twoFactorRedirect'] === true).toBe(asksAgain);
  });

  it('survives a key change while the old key is kept, encrypts anew under the new one, and fails once the old key is gone', async () => {
    const w = await enrolled();
    await verify(w.auth, w.first, totp(w.secret));
    const old = w.options.secrets?.[0]?.value ?? '';
    const fresh = randomBytes(32).toString('hex');
    const both = rekey(w.options, [
      { version: 2, value: fresh },
      { version: 1, value: old },
    ]);
    const step = await verify(both, await signIn(both), totp(w.secret));
    expect(step.status).toBe(200);
    await call(
      both,
      HTTP,
      '/two-factor/generate-backup-codes',
      'POST',
      { password: PW },
      cookieOf(step),
    );
    expect(w.db.twoFactor[0]?.['backupCodes']).toMatch(/^\$ba\$2\$/);
    const only = rekey(w.options, [{ version: 2, value: fresh }]);
    expect((await verify(only, await signIn(only), totp(w.secret))).status).not.toBe(200);
  });
});

describe("changing one's password over HTTP (N162)", () => {
  const changeOver = (auth: Auth, from: Response, body: object, ip = freshIp()) =>
    auth.handler(
      new Request(`${HTTP}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: HTTP,
          'x-forwarded-for': ip,
          cookie: cookie(from).get('cookie') ?? '',
        },
        body: JSON.stringify(body),
      }),
    );

  it('ends every other session even when the client asks to keep them, and audits once', async () => {
    const audit = vi.fn(() => Promise.resolve());
    const { auth, userId } = await world(HTTP, (o) => o, { audit });
    const [here, there] = [await signIn(auth), await signIn(auth)];
    const res = await changeOver(auth, here, {
      currentPassword: PW,
      newPassword: PW2,
      revokeOtherSessions: false,
    });
    expect(res.status).toBe(200);
    expect(await auth.api.getSession({ headers: cookie(there) })).toBeNull();
    expect(audit.mock.calls).toEqual([[userId, 'user.password_changed']]);
  });

  it('audits nothing and keeps the sessions when the current password is wrong', async () => {
    const audit = vi.fn(() => Promise.resolve());
    const { auth } = await world(HTTP, (o) => o, { audit });
    const [here, there] = [await signIn(auth), await signIn(auth)];
    const res = await changeOver(auth, here, { currentPassword: PW2, newPassword: PW2 });
    expect(res.status).toBe(400);
    expect(await auth.api.getSession({ headers: cookie(there) })).not.toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it('still answers 200 when the audit fails: the password has changed already', async () => {
    const audit = vi.fn(() => Promise.reject(new Error('down')));
    const { auth } = await world(HTTP, (o) => o, { audit });
    const res = await changeOver(auth, await signIn(auth), {
      currentPassword: PW,
      newPassword: PW2,
    });
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('answers 429 from the 6th attempt of one address within a minute', async () => {
    const { auth } = await world();
    const from = await signIn(auth);
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1)
      statuses.push(
        (await changeOver(auth, from, { currentPassword: PW2, newPassword: PW2 }, ip)).status,
      );
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });
});
