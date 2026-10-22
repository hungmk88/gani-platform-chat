import 'reflect-metadata';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// POST /v1/members/invite (N152) over HTTP with the whole application, PostgreSQL and an SMTP server in the process.
// Org A: an owner, an admin (both with a second factor), a manager.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const orgA = randomUUID();
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
const mails: string[] = [];
let smtp: SMTPServer;
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);
const sha256 = (token: string) => createHash('sha256').update(token, 'utf8').digest();
/** The token of the last email to `to` (quoted-printable writes the = of the link as =3D). */
function tokenTo(to: string): string {
  const mail = mails.filter((m) => m.includes(to)).at(-1) ?? '';
  const found = /invite#token=(?:3D)?([A-Za-z0-9_-]{43})/.exec(mail.replace(/=\r?\n/g, ''));
  return found?.[1] ?? '';
}
const rowOf = async (id: string) =>
  (await q('SELECT * FROM org_members WHERE id = $1', [id])).rows[0] as Record<string, unknown>;

// prettier-ignore
async function person(key: string, role: string, hash: string) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), orgA, id, role]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[key] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  // After the sign-in: with a second factor on, /sign-in/email would ask for it (N93).
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
type Answer = { status: number; body: Record<string, unknown> };
async function post(
  who: string,
  path: string,
  body?: unknown,
  key: string = randomUUID(),
): Promise<Answer> {
  const res = await fetch(`${url}/v1/members/${path}`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN, 'idempotency-key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const invite = (who: string, email: string, role: string, key?: string) =>
  post(who, 'invite', { email, role }, key);
const email = () => `${randomUUID()}@example.test`;

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, _session, done) {
      let data = '';
      stream.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
      stream.on('end', () => (mails.push(data), done()));
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const smtpPort = (smtp.server.address() as AddressInfo).port;
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true',
    SMTP_URL: `smtp://127.0.0.1:${smtpPort}`, EMAIL_FROM: 'Gani <no-reply@example.test>' });
  await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [orgA, `t-${orgA}`, 'Gani Foods']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager']) await person(role, role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  const users = Object.values(people);
  for (const [text, ids] of [
    ['idempotency_keys WHERE org_id', [orgA]], ['audit_logs WHERE org_id', [orgA]], ['sessions WHERE user_id', users],
    ['org_members WHERE org_id', [orgA]], ['accounts WHERE user_id', users], ['users WHERE id', users],
    ['organizations WHERE id', [orgA]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('POST /v1/members/invite', () => {
  it('stores the SHA-256 of a token that only the email holds, audits without the email, and answers without the token', async () => {
    const to = email();
    const res = await invite('owner', `  ${to.toUpperCase()} `, 'sales');
    expect(res).toMatchObject({
      status: 201,
      body: { email: to, role: 'sales', status: 'pending', emailSent: true },
    });
    const id = res.body['id'] as string;
    const token = tokenTo(to);
    expect(token).toHaveLength(43);
    expect(JSON.stringify(res.body)).not.toContain(token);
    const row = await rowOf(id);
    expect(row).toMatchObject({
      org_id: orgA,
      invited_email: to,
      invited_by: people['owner'],
      user_id: null,
    });
    expect(row['invite_token_hash']).toEqual(sha256(token));
    const mail = mails.at(-1) ?? '';
    expect(mail).toContain('Gani Foods');
    expect(mail).toContain(`${ORIGIN}/invite#token=`);
    const audit = (
      await q('SELECT actor_user_id, detail FROM audit_logs WHERE target_id = $1 AND action = $2', [
        id,
        'member.invited',
      ])
    ).rows;
    expect(audit).toEqual([{ actor_user_id: people['owner'], detail: { role: 'sales' } }]);
  });

  it('refuses a second invitation of the same email, and answers a retried request as the first without a second email', async () => {
    const to = email();
    const key = randomUUID();
    const first = await invite('admin', to, 'support', key);
    expect(first.status).toBe(201);
    const sent = mails.length;
    expect(await invite('admin', to, 'support', key)).toEqual(first);
    expect(mails.length).toBe(sent);
    expect(await invite('owner', to, 'viewer')).toMatchObject({
      status: 409,
      body: { code: 'duplicate_resource' },
    });
  });

  it('lets an Owner invite an Owner, an Admin anyone but an Owner, and nobody else invite', async () => {
    expect((await invite('owner', email(), 'owner')).status).toBe(201);
    expect((await invite('admin', email(), 'admin')).status).toBe(201);
    const refused = [
      await invite('admin', email(), 'owner'),
      await invite('manager', email(), 'viewer'),
    ];
    expect(refused.map((r) => [r.status, r.body['code']])).toEqual([
      [403, 'forbidden'],
      [403, 'forbidden'],
    ]);
    expect((await invite('owner', 'not an email', 'sales')).status).toBe(400);
    expect((await invite('owner', email(), 'king')).status).toBe(400);
  });
});

describe('when the email cannot be sent', () => {
  it('keeps the invitation and says emailSent: false', async () => {
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    const res = await invite('owner', email(), 'viewer');
    expect(res).toMatchObject({ status: 201, body: { emailSent: false } });
    expect(await rowOf(res.body['id'] as string)).toMatchObject({ status: 'pending' });
  }, 30_000);
});
