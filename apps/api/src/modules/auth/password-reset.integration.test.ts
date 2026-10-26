import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { EmailMessage } from '@gani/email';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuth } from './auth.config.js';
import { loadAuthEnv } from './auth.env.js';
import { hashPassword } from './password.js';

// "Quên mật khẩu" (N162) over HTTP with Better Auth as it is configured (createAuth), as auth_role, on PostgreSQL. The sender keeps the
// messages; the work done after the answer is awaited through `later`.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [OLD, NEW] = [
  `a1${randomBytes(15).toString('base64url')}`,
  `b2${randomBytes(15).toString('base64url')}`,
];
const user = randomUUID();
const email = `${user}@example.test`;
const pool = createDbPool(need('DATABASE_URL_AUTH'), { max: 3 });
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const sent: EmailMessage[] = [];
const jobs: Promise<void>[] = [];
const auth = createAuth({
  pool,
  env: loadAuthEnv({
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: ORIGIN,
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  }),
  sender: { send: (m) => (sent.push(m), Promise.resolve()), close: () => Promise.resolve() },
  later: (job) => void jobs.push(job()),
});
const post = async (path: string, body: object, origin = ORIGIN) => {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        'x-forwarded-for': [...randomBytes(4)].join('.'),
      },
      body: JSON.stringify(body),
    }),
  );
  await Promise.all(jobs.splice(0));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const signIn = async (password: string) =>
  (
    await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({ 'x-forwarded-for': [...randomBytes(4)].join('.') }),
      asResponse: true,
    })
  ).status;
const tokenOf = (m: EmailMessage | undefined) =>
  /#token=([A-Za-z0-9_-]+)/.exec(m?.text ?? '')?.[1] ?? '';

beforeAll(async () => {
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at) VALUES ($1, $2, 'active', now())`,
    [user, email],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), user, user, await hashPassword(OLD)],
  );
});

afterAll(async () => {
  for (const t of ['sessions', 'accounts'])
    await admin.query(`DELETE FROM ${t} WHERE user_id = $1`, [user]).catch(() => undefined);
  await admin.query('DELETE FROM verifications WHERE value = $1', [user]).catch(() => undefined);
  await admin.query('DELETE FROM users WHERE id = $1', [user]).catch(() => undefined);
  await Promise.all([pool.end(), admin.end()]);
});

describe('POST /api/auth/password/forgot and /password/reset', () => {
  it('mails a one-time link to a person, sets a strong password with it, and refuses it afterwards', async () => {
    expect(await post('/password/forgot', { email: ` ${email.toUpperCase()} ` })).toEqual({
      status: 202,
      body: { accepted: true },
    });
    expect(sent.map((m) => m.to)).toEqual([email]);
    const token = tokenOf(sent[0]);
    expect(sent[0]?.text).toContain(`${ORIGIN}/reset-password#token=${token}`);
    expect((await post('/password/reset', { token, password: 'short' })).body['code']).toBe(
      'PASSWORD_TOO_WEAK',
    );
    expect(await post('/password/reset', { token, password: NEW })).toEqual({
      status: 200,
      body: { reset: true },
    });
    expect([await signIn(NEW), await signIn(OLD)]).toEqual([200, 401]);
    const again = await post('/password/reset', { token, password: NEW });
    expect([again.status, again.body['code'], again.body['message']]).toEqual([
      404,
      'RESET_INVALID',
      'Link không hợp lệ hoặc đã hết hạn.',
    ]);
  });

  it('answers an unknown address as a known one, and sends one address at most 3 links in 15 minutes', async () => {
    sent.length = 0;
    expect(await post('/password/forgot', { email: `nobody-${user}@example.test` })).toEqual({
      status: 202,
      body: { accepted: true },
    });
    expect(sent).toEqual([]);
    // The first test took one of the 3 links of this address: of 4 more asks, 2 send and all answer alike.
    for (let i = 0; i < 4; i += 1)
      expect((await post('/password/forgot', { email })).status).toBe(202);
    expect(sent).toHaveLength(2);
  });

  it('refuses another origin, a malformed address and a token that was never made, alike for every token', async () => {
    const answers = [
      await post('/password/forgot', { email }, 'https://evil.example'),
      await post(
        '/password/reset',
        { token: 'x'.repeat(43), password: NEW },
        'https://evil.example',
      ),
      await post('/password/forgot', { email: 'not-an-email' }),
      await post('/password/reset', { token: 'x'.repeat(43), password: NEW }),
      await post('/password/reset', { token: 'short', password: NEW }),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 403, 400, 404, 404]);
  });
});
