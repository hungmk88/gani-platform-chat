import 'reflect-metadata';

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// /api/auth/invite/lookup and /accept (DB-02b, N151) over HTTP with the whole application: the 2FA gate, Better Auth and PostgreSQL.
// One organisation; each test makes its own invitations. An `active` person is a member already.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const ORG = randomUUID();
const PASSWORD = 'correct horse 42 battery';
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const emails: string[] = [];
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

async function invite(role = 'sales', email = `${randomUUID()}@example.test`) {
  const token = randomBytes(32).toString('base64url');
  emails.push(email);
  // prettier-ignore
  await q(`INSERT INTO org_members (id, org_id, invited_email, role, status, invite_token_hash, invite_expires_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, now() + interval '7 days')`,
    [randomUUID(), ORG, email, role, createHash('sha256').update(token, 'utf8').digest()]);
  return { token, email };
}
type Answer = { status: number; body: Record<string, unknown>; cookie: string };
async function post(
  path: string,
  body: object,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const res = await fetch(`${url}/api/auth${path}`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.'), ...headers },
    body: JSON.stringify(body),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie };
}
const get = async (path: string, cookie: string) => {
  const res = await fetch(`${url}${path}`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [ORG, `t-${ORG}`, 'Gani Foods']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const { rows } = await q('SELECT id FROM users WHERE email = ANY($1)', [emails]);
  const users = rows.map((r: { id: string }) => r.id);
  for (const [text, ids] of [
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [ORG]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [ORG]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('POST /api/auth/invite/lookup', () => {
  it('says whom a live invitation is for, and gives one answer to every other token', async () => {
    const { token, email } = await invite('manager');
    expect(await post('/invite/lookup', { token })).toMatchObject({
      status: 200,
      body: { invitedEmail: email, role: 'manager' },
    });
    const wrong = await post('/invite/lookup', { token: randomBytes(32).toString('base64url') });
    const malformed = await post('/invite/lookup', { token: 'x' });
    expect([wrong.status, malformed.status]).toEqual([404, 404]);
    expect(malformed.body).toEqual(wrong.body);
    expect(wrong.body).toMatchObject({ code: 'INVITE_INVALID' });
  });
});

describe('POST /api/auth/invite/accept', () => {
  it('gives a new person their password and a session in the organisation that invited them, once', async () => {
    const { token, email } = await invite('sales');
    const accepted = await post('/invite/accept', { token, password: PASSWORD, name: 'Lan' });
    expect(accepted).toMatchObject({ status: 200, body: { orgId: ORG, role: 'sales' } });
    expect(accepted.body).not.toHaveProperty('token');
    const me = await get('/v1/me', accepted.cookie);
    expect(me).toMatchObject({
      status: 200,
      body: { name: 'Lan', org: { id: ORG, role: 'sales' } },
    });
    // The password works for a sign-in of its own, and the token does not work twice.
    const signIn = await post('/sign-in/email', { email, password: PASSWORD });
    expect(signIn.status).toBe(200);
    const again = await post('/invite/accept', { token, password: PASSWORD });
    expect(again).toMatchObject({ status: 404, body: { code: 'INVITE_INVALID' } });
  });

  it('sends an Owner straight to the set-up of the second factor', async () => {
    const { token } = await invite('owner');
    const accepted = await post('/invite/accept', { token, password: PASSWORD });
    expect(accepted.status).toBe(200);
    expect(await get('/v1/me/security-status', accepted.cookie)).toMatchObject({
      status: 200,
      body: { required: true, mustSetUp: true },
    });
    expect((await get('/v1/me', accepted.cookie)).body).toMatchObject({
      code: 'two_factor_setup_required',
    });
  });

  it('refuses another Origin, or none, and a weak password, leaving the invitation as it was', async () => {
    const { token } = await invite();
    expect(
      (
        await post(
          '/invite/accept',
          { token, password: PASSWORD },
          { origin: 'https://evil.example' },
        )
      ).status,
    ).toBe(403);
    const none = await fetch(`${url}/api/auth/invite/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(none.status).toBe(403);
    expect(await post('/invite/accept', { token, password: 'short1' })).toMatchObject({
      status: 400,
      body: { code: 'PASSWORD_TOO_WEAK' },
    });
    expect((await post('/invite/lookup', { token })).status).toBe(200);
  });

  it('refuses an email that already has an account when its owner is not signed in, with the same answer', async () => {
    const id = randomUUID();
    const email = `${id}@example.test`;
    // prettier-ignore
    await q(`INSERT INTO users (id, email, status, email_verified_at) VALUES ($1, $2, 'active', now())`, [id, email]);
    await q(
      `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
      [randomUUID(), id, id, await hashPassword(PASSWORD)],
    );
    const { token } = await invite('viewer', email);
    expect(await post('/invite/accept', { token, password: PASSWORD })).toMatchObject({
      status: 404,
      body: { code: 'INVITE_INVALID' },
    });
    // Signed in, the same person takes it.
    const signIn = await post('/sign-in/email', { email, password: PASSWORD });
    const taken = await post('/invite/accept', { token }, { cookie: signIn.cookie });
    expect(taken).toMatchObject({ status: 200, body: { orgId: ORG, role: 'viewer' } });
  });

  it('lets a token be tried 10 times a minute, whatever the address', async () => {
    const { token } = await invite();
    const answers = [];
    for (let i = 0; i < 11; i++) answers.push((await post('/invite/lookup', { token })).status);
    expect(answers.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(answers[10]).toBe(429);
  });
});
