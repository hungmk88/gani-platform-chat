import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// P11b-2a (N207): GET /v1/security-alerts over HTTP with both pools on PostgreSQL. Org X has four alerts, one covered by an incident;
// org Y one alert, never seen from X. A platform operator reads X only through an access session of X.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: this test needs PostgreSQL (the db job of CI)`);
  return value;
};
const ROLES = ['owner', 'admin', 'manager', 'sales', 'marketing', 'viewer', 'support'] as const;
const [X, Y, SESSION] = [randomUUID(), randomUUID(), randomUUID()];
const [INCIDENT, ALERT_Y] = [uuidv7(), uuidv7()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const q = (text: string, params: unknown[] = []) => admin.query(text, params);
const people: Record<string, { id: string; cookie: string }> = {};
const id = (key: string) => people[key]!.id;
const alertsX: string[] = [];
let url = '';
let app: NestExpressApplication;

/** A person: a member of `org` with `role`, or a platform operator; signed in before 2FA is set, unless `login` is false. */
async function person(
  key: string,
  o: { org?: string; role?: string; operator?: boolean; login?: boolean },
) {
  const [user, email] = [randomUUID(), `${randomUUID()}@example.test`];
  await q(
    `INSERT INTO users (id, email, status, email_verified_at, display_name, is_platform_operator) VALUES ($1, $2, 'active', now(), 'T', $3)`,
    [user, email, o.operator === true],
  );
  // user_id (uuid) and account_id (text) are separate parameters: one parameter for both is "inconsistent types" (lesson 26).
  await q(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), user, user, await hashPassword(PW)],
  );
  if (o.role)
    await q(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`,
      [randomUUID(), o.org ?? X, user, o.role],
    );
  if (o.login === false) {
    people[key] = { id: user, cookie: '' };
    return user;
  }
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
  people[key] = { id: user, cookie };
  return user;
}
const alert = (
  alertId: string,
  org: string,
  severity: string,
  minute: number,
  incident: string | null,
) =>
  q(
    `INSERT INTO security_alerts (id, org_id, kind, severity, window_start, occurred_at, count, incident_id) VALUES ($1, $2,
       'login_failures', $3, '2026-11-08T08:00:00Z'::timestamptz + make_interval(mins => $4), '2026-11-08T08:00:00Z'::timestamptz + make_interval(mins => $4), 5, $5)`,
    [alertId, org, severity, minute, incident],
  );
const get = (key: string, path: string, session?: string) =>
  fetch(`${url}${path}`, {
    headers: {
      origin: 'http://localhost:3000',
      cookie: people[key]?.cookie ?? '',
      ...(session === undefined ? {} : { 'x-access-session-id': session }),
    },
  });
type Page = { data: Record<string, unknown>[]; nextCursor: string | null };
const page = async (res: Response) => {
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
};
/** The ids of one page of `path`, read as `key` (with an access session, for an operator). */
const idsAt = async (key: string, path: string, session?: string) =>
  (await page(await get(key, path, session))).data.map((r) => r['id']);
const codeOf = async (res: Response) => [res.status, ((await res.json()) as { code: string }).code];

beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, {
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  for (const org of [X, Y])
    await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      org,
      `t-${org}`,
      'T',
    ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  for (const role of ROLES) await person(role, { role });
  await person('op', { operator: true });
  for (const key of ['owner', 'admin', 'op'])
    await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id(key)]);
  await q(
    `INSERT INTO security_incidents (id, org_id, title, severity, handler_user_id, opened_by_user_id)
     VALUES ($1, $2, 'Đăng nhập lạ', 'high', $3, $4)`,
    [INCIDENT, X, id('owner'), id('owner')],
  );
  for (const [severity, minute, inc] of [
    ['low', 0, null],
    ['high', 15, INCIDENT],
    ['high', 30, null],
    ['critical', 45, null],
  ] as const) {
    alertsX.push(uuidv7());
    await alert(alertsX.at(-1)!, X, severity, minute, inc);
  }
  await alert(ALERT_Y, Y, 'critical', 0, null);
  await q(
    `INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, expires_at)
     VALUES ($1, $2, $3, 'support_test', 'P11b-2a', now() + interval '30 minutes')`,
    [SESSION, X, id('op')],
  );
});

afterAll(async () => {
  await app.close();
  const users = Object.values(people).map((p) => p.id);
  // Children first (foreign keys). A failing step is swallowed because the CI database is ephemeral.
  for (const [table, column, keys] of [
    ['platform_access_logs', 'org_id', [X, Y]],
    ['security_alerts', 'org_id', [X, Y]],
    ['security_incidents', 'org_id', [X, Y]],
    ['sessions', 'user_id', users],
    ['org_members', 'org_id', [X, Y]],
    ['organizations', 'id', [X, Y]],
    ['accounts', 'user_id', users],
    ['users', 'id', users],
  ] as const)
    await q(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [keys]).catch(
      () => undefined,
    );
  await admin.end();
});

describe('who reads the security alerts (P11b-2a)', () => {
  it('lets an Owner and an Admin read them, and refuses the five other roles before reading', async () => {
    for (const role of ROLES) {
      const res = await get(role, '/v1/security-alerts');
      if (role === 'owner' || role === 'admin') expect(res.status, role).toBe(200);
      else expect(await codeOf(res), role).toEqual([403, 'forbidden']);
    }
  });

  it('lets a platform operator read organisation X through its session, never Y, and still not /v1/customers', async () => {
    const alerts = await idsAt('op', '/v1/security-alerts', SESSION);
    expect(alerts).toEqual([...alertsX].reverse());
    expect(alerts).not.toContain(ALERT_Y);
    expect(await codeOf(await get('op', '/v1/customers', SESSION))).toEqual([403, 'forbidden']);
    expect((await get('op', '/v1/security-alerts')).status).toBe(403);
  });
});

describe('GET /v1/security-alerts', () => {
  it('answers the alerts of X newest first, a page at a time, by severity and by open', async () => {
    const first = await page(await get('owner', '/v1/security-alerts?limit=3'));
    expect(first.data.map((r) => r['id'])).toEqual([alertsX[3], alertsX[2], alertsX[1]]);
    expect(first.data[2]).toEqual({
      id: alertsX[1],
      kind: 'login_failures',
      severity: 'high',
      occurredAt: '2026-11-08T08:15:00.000Z',
      subjectUserId: null,
      channelAccountId: null,
      count: 5,
      incidentId: INCIDENT,
    });
    const next = `/v1/security-alerts?limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`;
    const second = await page(await get('owner', next));
    expect([second.data.map((r) => r['id']), second.nextCursor]).toEqual([[alertsX[0]], null]);
    expect(await idsAt('admin', '/v1/security-alerts?severity=high')).toEqual([
      alertsX[2],
      alertsX[1],
    ]);
    expect(await idsAt('admin', '/v1/security-alerts?open=true')).not.toContain(alertsX[1]);
    expect(await idsAt('admin', '/v1/security-alerts?open=false')).toEqual([alertsX[1]]);
    expect((await get('owner', '/v1/security-alerts?cursor=nope')).status).toBe(400);
  });
});
