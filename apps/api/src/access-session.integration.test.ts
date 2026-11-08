import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';
import {
  currentActorContext,
  currentRequestContext,
} from './modules/request-context/request-context.js';

// P11b-1 (U79, N207, CEO 08/11): X-Access-Session-Id through the real gate and middleware, both pools, `app.access_session_org` on
// PostgreSQL. Fail-closed: a session opens no module yet, writes outside N207 B1 are refused, and members without the header are as before.
@Controller('v1/test')
class ActorController {
  @Get('member')
  member() {
    return currentRequestContext();
  }

  @Get('actor')
  actor() {
    return currentActorContext();
  }
}

const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ROLES = ['owner', 'admin', 'manager', 'sales', 'marketing', 'viewer', 'support'] as const;
const [org, otherOrg] = [randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, { id: string; email: string; cookie: string }> = {};
const sessions = {
  live: randomUUID(),
  other: randomUUID(),
  expired: randomUUID(),
  ended: randomUUID(),
  no2fa: randomUUID(),
};
let app: NestExpressApplication;
let url = '';

async function person(key: string, opts: { role?: string; operator?: boolean }) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name, is_platform_operator)
     VALUES ($1, $2, 'active', now(), 'T', $3)`,
    [id, email, opts.operator === true],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), id, id, await hashPassword(PW)],
  );
  if (opts.role)
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`,
      [randomUUID(), org, id, opts.role],
    );
  // Signed in BEFORE two_factor_enabled is set: once it is, /sign-in/email asks for the second step and issues no session cookie.
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'x-forwarded-for': [...randomBytes(4)].join('.'),
    },
    body: JSON.stringify({ email, password: PW }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  people[key] = { id, email, cookie };
}
const enableTwoFactor = (key: string) =>
  admin.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [people[key]?.id]);
/** An access session row as the platform module writes it; `ago` minutes in the past, `ended` by the operator. */
const accessSession = (id: string, operator: string, of = org, ago = 0, ended = false) =>
  admin.query(
    `INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, created_at, expires_at, ended_at, end_reason)
     VALUES ($1, $2, $3, 'support_test', 'P11b-1', now() - make_interval(mins => $4), now() - make_interval(mins => $4) + interval '30 minutes',
             CASE WHEN $5 THEN now() END, CASE WHEN $5 THEN 'manual' END)`,
    [id, of, people[operator]?.id, ago, ended],
  );
const call = (key: string, path: string, session?: string, method = 'GET') =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      origin: 'http://localhost:3000',
      cookie: people[key]?.cookie ?? '',
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(session === undefined ? {} : { 'x-access-session-id': session }),
    },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
const answer = async (res: Response) => ({
  status: res.status,
  body: (await res.json()) as Record<string, unknown>,
});

beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, {
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  for (const id of [org, otherOrg])
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      `t-${id}`,
      'T',
    ]);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ActorController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  for (const role of ROLES) await person(role, { role });
  for (const key of ['op', 'op2', 'opNo2fa']) await person(key, { operator: true });
  for (const key of ['owner', 'admin', 'op', 'op2']) await enableTwoFactor(key);
  await accessSession(sessions.live, 'op');
  await accessSession(sessions.other, 'op2');
  await accessSession(sessions.expired, 'op', org, 120);
  await accessSession(sessions.ended, 'op', org, 0, true);
  await accessSession(sessions.no2fa, 'opNo2fa');
});

afterAll(async () => {
  await app.close();
  const ids = Object.values(people).map((p) => p.id);
  // Children first (foreign keys). A failing step is swallowed because the CI database is ephemeral.
  const steps: [string, unknown[]][] = [
    ['DELETE FROM platform_access_logs WHERE org_id = ANY($1::uuid[])', [[org, otherOrg]]],
    ['DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [ids]],
    ['DELETE FROM org_members WHERE org_id = $1', [org]],
    ['DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[org, otherOrg]]],
    ['DELETE FROM accounts WHERE user_id = ANY($1::uuid[])', [ids]],
    ['DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]],
  ];
  for (const [text, params] of steps) await admin.query(text, params).catch(() => undefined);
  await admin.end();
});

describe('X-Access-Session-Id over HTTP (P11b-1)', () => {
  it('leaves every member role as it was without the header (regression)', async () => {
    for (const role of ROLES) {
      const { status, body } = await answer(await call(role, '/v1/test/member'));
      expect(status, role).toBe(200);
      expect(body, role).toMatchObject({ userId: people[role]?.id, orgId: org, role });
    }
    expect((await call('owner', '/v1/customers')).status).toBe(200);
  });

  it('refuses a member who sends the header with not_platform_operator, not as the member', async () => {
    for (const role of ['owner', 'sales'] as const) {
      const { status, body } = await answer(await call(role, '/v1/test/member', sessions.live));
      expect([status, body.code], role).toEqual([403, 'not_platform_operator']);
    }
  });

  it('is 403 access_session_expired for an unknown, expired or ended session, or one of another operator', async () => {
    for (const session of [randomUUID(), sessions.expired, sessions.ended, sessions.other, 'x']) {
      const { status, body } = await answer(await call('op', '/v1/test/actor', session));
      expect([status, body.code], session).toEqual([403, 'access_session_expired']);
    }
  });

  it('gives the operator the organisation of the session, as platform_operator, and opens no module (fail-closed)', async () => {
    const { status, body } = await answer(await call('op', '/v1/test/actor', sessions.live));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      role: 'platform_operator',
      userId: people['op']?.id,
      orgId: org,
      accessSessionId: sessions.live,
      workspaceIds: [],
    });
    for (const path of ['/v1/test/member', '/v1/customers']) {
      const refused = await answer(await call('op', path, sessions.live));
      expect([refused.status, refused.body.code], path).toEqual([403, 'forbidden']);
    }
  });

  it('refuses every write but the two of N207 B1, which pass the middleware (no route serves them yet)', async () => {
    const refused = await answer(await call('op', '/v1/customers', sessions.live, 'POST'));
    expect([refused.status, refused.body.code]).toEqual([403, 'forbidden']);
    expect((await call('op', '/v1/security-incidents', sessions.live, 'POST')).status).toBe(404);
  });

  it('still asks an operator without a second factor to set it up first, before the session is looked at', async () => {
    const { status, body } = await answer(await call('opNo2fa', '/v1/test/actor', sessions.no2fa));
    expect([status, body.code]).toEqual([403, 'two_factor_setup_required']);
  });

  it('serves an operator without the header as before: no organisation of their own', async () => {
    const { status, body } = await answer(await call('op', '/v1/test/actor'));
    expect([status, body.code]).toEqual([403, 'no_organisation']);
  });
});
