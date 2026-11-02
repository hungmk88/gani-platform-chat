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

// /v1/workspaces/{id}/business-hours (C10-3a, N192) over HTTP with the whole application and PostgreSQL. Org A: one person of each of
// the 7 roles in workspace W; org B: workspace WB.
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
type Day = { weekday: number; open: boolean; opensAt: string | null; closesAt: string | null };
async function call(who: string, method: 'GET' | 'PUT', ws: string, body?: unknown) {
  const res = await fetch(`${url}/v1/workspaces/${ws}/business-hours`, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const closed = {
  open: false,
  opensAt: null,
  closesAt: null,
  breakStartsAt: null,
  breakEndsAt: null,
};
const open = {
  open: true,
  opensAt: '07:30',
  closesAt: '17:00',
  breakStartsAt: '12:00',
  breakEndsAt: '13:00',
};
const week = (days: Record<number, object> = {}) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    ...(weekday <= 5 ? open : closed),
    ...days[weekday],
  }));
const audits = async () =>
  (
    await admin.query<{ detail: unknown }>(
      `SELECT detail FROM audit_logs WHERE org_id = $1 AND action = 'workspace.hours_changed' ORDER BY id`,
      [orgA],
    )
  ).rows;

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
    ['audit_logs WHERE org_id', [orgA, orgB]], ['workspace_hours WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/workspaces/{id}/business-hours', () => {
  it('lets only an Owner or an Admin read it: the default week while none is set', async () => {
    const statuses = await Promise.all(ROLES.map(async (r) => (await call(r, 'GET', W)).status));
    expect(statuses).toEqual([200, 200, 403, 403, 403, 403, 403]);
    const res = await call('admin', 'GET', W);
    expect(res.body).toMatchObject({ timezone: 'Asia/Ho_Chi_Minh', isDefault: true });
    const days = res.body['week'] as Day[];
    expect(days.map((d) => [d.weekday, d.open, d.opensAt, d.closesAt])).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => [n, true, '08:00', '18:00']),
      [6, false, null, null],
      [7, false, null, null],
    ]);
    expect((await call('owner', 'GET', WB)).status).toBe(404);
  });

  it('replaces the week, audits the weekdays that changed, and refuses a wrong week', async () => {
    const set = await call('owner', 'PUT', W, {
      week: week({ 6: { open: true, opensAt: '08:00', closesAt: '11:30' } }),
    });
    expect(set).toMatchObject({ status: 200, body: { isDefault: false } });
    expect((set.body['week'] as Day[])[5]).toMatchObject({
      weekday: 6,
      open: true,
      closesAt: '11:30',
    });
    expect((await call('admin', 'GET', W)).body).toEqual(set.body);
    expect(await audits()).toEqual([{ detail: { weekdays: '1,2,3,4,5,6' } }]);
    expect(
      (
        await call('admin', 'PUT', W, {
          week: week({ 6: { open: true, opensAt: '08:00', closesAt: '11:30' } }),
        })
      ).status,
    ).toBe(200);
    expect(await audits()).toHaveLength(1);
    for (const bad of [
      { week: week().slice(1) },
      { week: week({ 1: { opensAt: '18:00' } }) },
      { week: week({ 7: { opensAt: '08:00' } }) },
      {},
    ])
      expect((await call('owner', 'PUT', W, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await call('manager', 'PUT', W, { week: week() })).status).toBe(403);
    expect((await call('owner', 'PUT', WB, { week: week() })).status).toBe(404);
    expect(await audits()).toHaveLength(1);
  });
});
