import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// /v1/workspaces/{id}/holidays (C10-3b-i, N192, U44) over HTTP with the whole application and PostgreSQL. Org A: one person of each of
// the 7 roles in workspace W (Asia/Ho_Chi_Minh); org B: workspace WB.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const ROLES = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'];
const [orgA, orgB, W, WB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(role: string, hash: string) {
  const id = (people[role] = uuidv7());
  await q(`INSERT INTO users (id, email, status, email_verified_at) VALUES ($1, $2, 'active', now())`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [uuidv7(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [uuidv7(), orgA, id, role]);
  await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [uuidv7(), orgA, W, id]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
type Holiday = { id: string; name: string; startsOn: string; endsOn: string };
async function call(
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${url}/v1/workspaces/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookies[who] ?? '',
      origin: ORIGIN,
      ...(method === 'POST' ? { 'idempotency-key': uuidv7() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    body: res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>),
  };
}
/** The date `n` days from today in the workspace's time zone, as the API reckons "today". */
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
const add = (name: string, startsOn: string, endsOn: string, who = 'owner') =>
  call(who, 'POST', `${W}/holidays`, { name, startsOn, endsOn });
const actions = async () =>
  (
    await admin.query<{ action: string; detail: Record<string, string> }>(
      `SELECT action, detail FROM audit_logs WHERE org_id = $1 AND action LIKE 'workspace.holiday%' ORDER BY id`,
      [orgA],
    )
  ).rows.map((r) => [
    r.action.slice('workspace.holiday_'.length),
    r.detail['code'] ?? r.detail['startsOn'],
  ]);
const past = uuidv7();

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ww', 'W', 'service'), ($3, $4, 'wb', 'WB', 'service')`, [W, orgA, WB, orgB]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ROLES) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['audit_logs WHERE org_id', [orgA, orgB]], ['workspace_holidays WHERE org_id', [orgA, orgB]], ['idempotency_keys WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/workspaces/{id}/holidays', () => {
  it('lets only an Owner or an Admin add days off, refuses an overlap or a day that is over, and audits each', async () => {
    const statuses = await Promise.all(
      ROLES.map(async (r) => (await call(r, 'GET', `${W}/holidays`)).status),
    );
    expect(statuses).toEqual([200, 200, 403, 403, 403, 403, 403]);
    expect((await call('owner', 'GET', `${WB}/holidays`)).status).toBe(404);
    expect(
      (
        await call('owner', 'POST', `${WB}/holidays`, {
          name: 'B',
          startsOn: day(1),
          endsOn: day(1),
        })
      ).status,
    ).toBe(404);
    expect(await add('Tết', day(30), day(36))).toMatchObject({
      status: 201,
      body: { name: 'Tết', startsOn: day(30) },
    });
    expect((await add('Hôm nay', day(0), day(0), 'admin')).status).toBe(201);
    expect(await add('Chồng', day(36), day(40))).toMatchObject({
      status: 422,
      body: { code: 'holiday_overlap' },
    });
    expect(await add('Đã qua', day(-3), day(-1))).toMatchObject({
      status: 422,
      body: { code: 'holiday_in_past' },
    });
    expect((await add('Ngược', day(9), day(8))).status).toBe(400);
    expect((await add('Quản lý', day(50), day(50), 'manager')).status).toBe(403);
    expect(await actions()).toEqual([
      ['added', day(30)],
      ['added', day(0)],
      ['rejected', 'holiday_overlap'],
      ['rejected', 'holiday_in_past'],
    ]);
  });

  it('lists the live days off from today by default (workspace time), from `from` when given, by start', async () => {
    await q(
      `INSERT INTO workspace_holidays (id, org_id, workspace_id, name, starts_on, ends_on) VALUES ($1, $2, $3, 'Cũ', $4, $4)`,
      [past, orgA, W, day(-5)],
    );
    const names = async (from = '') =>
      ((await call('admin', 'GET', `${W}/holidays${from}`)).body['data'] as Holiday[]).map(
        (h) => h.name,
      );
    expect(await names()).toEqual(['Hôm nay', 'Tết']);
    expect(await names(`?from=${day(-10)}`)).toEqual(['Cũ', 'Hôm nay', 'Tết']);
    expect(await names(`?from=${day(1)}`)).toEqual(['Tết']);
    expect((await call('owner', 'GET', `${W}/holidays?from=1/2/2027`)).status).toBe(400);
    expect((await call('owner', 'GET', `${W}/holidays?to=${day(1)}`)).status).toBe(400);
  });
});
