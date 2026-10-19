import 'reflect-metadata';

import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { createDbPool, orgMembers } from '@gani/db';
import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { AuthService } from './modules/auth/auth.service.js';
import { hashPassword } from './modules/auth/password.js';
import { DatabaseModule } from './modules/database/database.module.js';
import { DatabaseService } from './modules/database/database.service.js';
import { currentRequestContext } from './modules/request-context/request-context.js';

// N92: the tenant middleware over HTTP with both real pools (app_role, auth_role) on PostgreSQL. The route exists only here.
@Controller('v1')
class TestContextController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Post('test/context')
  async context(@Body() body: unknown) {
    const ctx = currentRequestContext();
    const rows = await this.database.withTenant(ctx, (tx) =>
      tx.select({ org: orgMembers.orgId }).from(orgMembers),
    );
    return { ctx, body, visibleOrgs: [...new Set(rows.map((r) => r.org))] };
  }
}

const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [orgA, orgB] = [randomUUID(), randomUUID()];
const [wsA, wsB] = [randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, { id: string; email: string }> = {};
let app: NestExpressApplication;
let url = '';
let port = 0;

async function person(key: string, memberships: [string, string, string?][]) {
  const id = randomUUID();
  people[key] = { id, email: `${id}@example.test` };
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [id, people[key]?.email],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), id, id, hash],
  );
  for (const [org, role, status = 'active'] of memberships) {
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), org, id, role, status],
    );
  }
  return id;
}
const workspaceFor = (org: string, ws: string, user: string) =>
  admin
    .query(
      `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service') ON CONFLICT DO NOTHING`,
      [ws, org, `w-${ws}`],
    )
    .then(() =>
      admin.query(
        `INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), org, ws, user],
      ),
    );

let hash = '';
async function login(key: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: people[key]?.email, password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
const call = (cookie: string | null, path = '/v1/test/context', init: RequestInit = {}) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    body: init.body ?? '{}',
  });
type Answer = { ctx: { userId: string; orgId: string; role: string; workspaceIds: string[] } };
const answerOf = async (res: Response) => (await res.json()) as Answer & { visibleOrgs: string[] };
const setActive = (key: string, org: string | null) =>
  admin.query('UPDATE sessions SET active_org_id = $1 WHERE user_id = $2', [org, people[key]?.id]);
const activeOf = async (key: string) =>
  (
    await admin.query<{ active_org_id: string | null }>(
      'SELECT active_org_id FROM sessions WHERE user_id = $1',
      [people[key]?.id],
    )
  ).rows.map((r) => r.active_org_id);
/** The status of a path sent exactly as written: fetch and `new URL` normalise dot segments on the client. */
const rawStatus = (path: string) =>
  new Promise<number>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST' }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail).end();
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
  hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) {
    await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      org,
      `t-${org}`,
      'T',
    ]);
  }
  await workspaceFor(orgA, wsA, await person('p', [[orgA, 'sales']]));
  await workspaceFor(orgB, wsB, await person('q', [[orgB, 'viewer']]));
  await person('one', [[orgA, 'sales']]);
  await person('multi', [
    [orgA, 'sales'],
    [orgB, 'sales'],
  ]);
  await person('gone', [
    [orgA, 'sales'],
    [orgB, 'sales'],
  ]);
  await person('left', [[orgA, 'sales']]);
  await person('none', []);
  await person('susp', [
    [orgA, 'sales', 'suspended'],
    [orgB, 'sales'],
  ]);
  const moduleRef = await Test.createTestingModule({
    // DatabaseModule is the same module (one pool) that HealthModule imports; it is named here so the test controller can inject it.
    imports: [AppModule, DatabaseModule],
    controllers: [TestContextController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  port = (app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
  const ids = Object.values(people).map((p) => p.id);
  // The order is required by the foreign keys (children first). A failing step is swallowed because the CI database is ephemeral.
  const steps: [string, unknown[]][] = [
    ['DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [ids]],
    ['DELETE FROM workspace_members WHERE org_id = ANY($1::uuid[])', [[orgA, orgB]]],
    ['DELETE FROM workspaces WHERE org_id = ANY($1::uuid[])', [[orgA, orgB]]],
    ['DELETE FROM org_members WHERE org_id = ANY($1::uuid[])', [[orgA, orgB]]],
    ['DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]],
    ['DELETE FROM accounts WHERE user_id = ANY($1::uuid[])', [ids]],
    ['DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]],
  ];
  for (const [text, params] of steps) await admin.query(text, params).catch(() => undefined);
  await admin.end();
});

describe('the tenant middleware over HTTP', () => {
  it('answers 401 as RFC 9457 without a session', async () => {
    const res = await call(null);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('keeps 50 interleaved requests of two people in two organisations apart', async () => {
    const [cookieP, cookieQ] = [await login('p'), await login('q')];
    const results = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        await sleep(randomInt(0, 40));
        const [key, cookie] = i % 2 === 0 ? (['p', cookieP] as const) : (['q', cookieQ] as const);
        return { key, answer: await answerOf(await call(cookie, '/v1/test/context')) };
      }),
    );
    for (const { key, answer } of results) {
      const mine =
        key === 'p'
          ? { org: orgA, ws: wsA, role: 'sales' }
          : { org: orgB, ws: wsB, role: 'viewer' };
      expect(answer.ctx).toMatchObject({
        userId: people[key]?.id,
        orgId: mine.org,
        role: mine.role,
      });
      expect(answer.ctx.workspaceIds).toEqual([mine.ws]);
      // The organisation of the context is also the one row-level security shows to the handler.
      expect(answer.visibleOrgs).toEqual([mine.org]);
    }
  });

  it('uses the only active organisation without writing it into the session', async () => {
    const cookie = await login('one');
    expect((await answerOf(await call(cookie))).ctx.orgId).toBe(orgA);
    expect(await activeOf('one')).toEqual([null]);
  });

  it('is 403 org_not_selected with several organisations and none chosen, and no_organisation with none', async () => {
    const several = await call(await login('multi'));
    expect(several.status).toBe(403);
    expect(several.headers.get('content-type')).toBe('application/problem+json');
    expect(await several.json()).toMatchObject({ code: 'org_not_selected' });
    const none = await call(await login('none'));
    expect(none.status).toBe(403);
    expect(await none.json()).toMatchObject({ code: 'no_organisation' });
  });

  it('uses the organisation the session has chosen', async () => {
    const cookie = await login('multi');
    await setActive('multi', orgB);
    expect((await answerOf(await call(cookie))).ctx.orgId).toBe(orgB);
    await setActive('multi', orgA);
    expect((await answerOf(await call(cookie))).ctx.orgId).toBe(orgA);
  });

  it('treats an organisation the person was removed from as not chosen', async () => {
    const cookie = await login('gone');
    await setActive('gone', orgA);
    expect((await answerOf(await call(cookie))).ctx.orgId).toBe(orgA);
    await admin.query(
      `UPDATE org_members SET status = 'suspended' WHERE org_id = $1 AND user_id = $2`,
      [orgA, people['gone']?.id],
    );
    expect((await answerOf(await call(cookie))).ctx.orgId).toBe(orgB);
    const left = await login('left');
    await setActive('left', orgA);
    await admin.query(`UPDATE org_members SET deleted_at = now() WHERE user_id = $1`, [
      people['left']?.id,
    ]);
    const res = await call(left);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_organisation' });
  });

  it('never takes the organisation from the query, a header or the body', async () => {
    const cookie = await login('p');
    const res = await call(cookie, `/v1/test/context?orgId=${orgB}&org_id=${orgB}`, {
      headers: { 'x-org-id': orgB },
      body: JSON.stringify({ orgId: orgB, org_id: orgB }),
    });
    const answer = await answerOf(res);
    expect(answer.ctx.orgId).toBe(orgA);
    expect(answer.visibleOrgs).toEqual([orgA]);
  });

  it('lets only the exact security-status path skip the middleware (raw paths)', async () => {
    // No route exists for it yet (6d-3): a request that got past the middleware is the router's 404, not the middleware's 401.
    for (const path of ['/v1/me/security-status', '/V1/ME/SECURITY-STATUS?a=1']) {
      expect(await rawStatus(path), path).toBe(404);
    }
    for (const path of [
      '/v1/x/../me/security-status',
      '/v1/me/security-status/',
      '/v1/me//security-status',
      '/v1/me/security-status%2f',
    ]) {
      expect(await rawStatus(path), path).toBe(401);
    }
  });
});

// Runs after the describe above, in file order: it relies on the memberships that one suspended and deleted.
describe('AuthService.activeOrganisationIds', () => {
  const ids = (key: string) => app.get(AuthService).activeOrganisationIds(people[key]?.id ?? '');

  it('lists none, one or several organisations', async () => {
    expect(await ids('none')).toEqual([]);
    expect(await ids('one')).toEqual([orgA]);
    expect(await ids('p')).toEqual([orgA]);
    expect(await ids('multi')).toEqual([orgA, orgB].sort());
  });

  it('leaves out a suspended membership and one that was deleted', async () => {
    expect(await ids('susp')).toEqual([orgB]);
    expect(await ids('left')).toEqual([]);
    expect(await ids('gone')).toEqual([orgB]);
  });
});
