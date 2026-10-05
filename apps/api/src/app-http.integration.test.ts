import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool, orgMembers } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';
import { DatabaseService } from './modules/database/database.service.js';

// N90: the whole application over HTTP with both real pools (app_role, auth_role) on PostgreSQL: Better Auth at /api/auth, the tenant transaction.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const PW = randomBytes(18).toString('base64url');
const user = randomUUID();
const email = `${user}@example.test`;
const [orgA, orgB] = [randomUUID(), randomUUID()];
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
let app: NestExpressApplication;
let url = '';

beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, {
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [user, email],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), user, user, await hashPassword(PW)],
  );
  for (const org of [orgA, orgB]) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      org,
      `t-${org}`,
      'T',
    ]);
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'sales', 'active')`,
      [randomUUID(), org, user],
    );
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  const run = (text: string) => admin.query(text, [user]).catch(() => undefined);
  await run('DELETE FROM sessions WHERE user_id = $1');
  await run('DELETE FROM org_members WHERE user_id = $1');
  await admin
    .query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]])
    .catch(() => undefined);
  await run('DELETE FROM accounts WHERE user_id = $1');
  await run('DELETE FROM users WHERE id = $1');
  await admin.end();
});

describe('the application over HTTP', () => {
  it('is alive and ready with both real pools', async () => {
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    expect((await fetch(`${url}/readyz`)).status).toBe(200);
  });

  it('signs a person in at /api/auth and reads the session back with the cookie it set', async () => {
    const res = await fetch(`${url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: PW }),
    });
    expect(res.status).toBe(200);
    const set = res.headers.getSetCookie().find((c) => c.includes('session_token')) ?? '';
    for (const part of ['HttpOnly', 'SameSite=Lax', 'Max-Age=43200']) expect(set).toContain(part);
    const session = await fetch(`${url}/api/auth/get-session`, {
      headers: { cookie: set.split(';')[0] ?? '' },
    });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(email);
  });

  it('reads tenant data only inside the organisation of the transaction (app_role, RLS)', async () => {
    const database = app.get(DatabaseService);
    const seen = (orgId: string) =>
      database.withTenant({ orgId, workspaceIds: [] }, (tx) =>
        tx.select({ org: orgMembers.orgId }).from(orgMembers),
      );
    expect((await seen(orgA)).map((r) => r.org)).toEqual([orgA]);
    expect((await seen(orgB)).map((r) => r.org)).toEqual([orgB]);
  });
});
