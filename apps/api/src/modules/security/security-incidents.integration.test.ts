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
import { OPERATOR_NAME } from './security.controller.js';

// P11b-2b (N207, N215): GET /v1/security-incidents over HTTP with both pools on PostgreSQL. Org X has three incidents; org Y one,
// never seen from X. A platform operator reads X only through an access session of X.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: this test needs PostgreSQL (the db job of CI)`);
  return value;
};
const ROLES = ['owner', 'admin', 'manager', 'sales', 'marketing', 'viewer', 'support'] as const;
const [X, Y, SESSION] = [randomUUID(), randomUUID(), randomUUID()];
const [I1, I2, I3, IY, ALERT] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const q = (text: string, params: unknown[] = []) => admin.query(text, params);
const people: Record<string, { id: string; cookie: string }> = {};
const id = (key: string) => people[key]!.id;
let url = '';
let app: NestExpressApplication;

/** A person: a member of `org` with `role`, `name` their display name (null: none); signed in before 2FA is set, unless `login` is false. */
async function person(
  key: string,
  o: { org?: string; role?: string; name?: string | null; operator?: boolean; login?: boolean },
) {
  const [user, email] = [randomUUID(), `${randomUUID()}@example.test`];
  await q(
    `INSERT INTO users (id, email, status, email_verified_at, display_name, is_platform_operator) VALUES ($1, $2, 'active', now(), $3, $4)`,
    [user, email, o.name === undefined ? 'T' : o.name, o.operator === true],
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
/** An incident of `org`, opened by the member `user` or by the platform operator `operator` (exactly one). */
const incident = (
  incidentId: string,
  org: string,
  handler: string,
  user: string | null,
  operator: string | null = null,
) =>
  q(
    `INSERT INTO security_incidents (id, org_id, title, severity, handler_user_id, opened_by_user_id, opened_by_operator_id)
     VALUES ($1, $2, 'Đăng nhập lạ', 'high', $3, $4, $5)`,
    [incidentId, org, handler, user, operator],
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
  const names: Record<string, string> = { owner: 'Chủ X', admin: 'Quản trị' };
  for (const role of ROLES) await person(role, { role, name: names[role] ?? 'T' });
  await person('op', { operator: true });
  for (const key of ['owner', 'admin', 'op'])
    await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id(key)]);
  const nameless = await person('nameless', { role: 'admin', name: null, login: false });
  const gone = await person('gone', { role: 'admin', login: false });
  const ownerY = await person('ownerY', { org: Y, role: 'owner', login: false });
  // I1: a handler with no name, an opener who has since left. I2: opened by the operator. I3 (newest, closed): opened by the Admin
  // "Quản trị", handled by the Owner "Chủ X", so each name comes from its own column.
  await incident(I1, X, nameless, gone);
  await q(`UPDATE org_members SET status = 'suspended' WHERE user_id = $1`, [gone]);
  await incident(I2, X, id('owner'), null, id('op'));
  await incident(I3, X, id('owner'), id('admin'));
  await q(`UPDATE security_incidents SET status = 'closed', closed_at = now() WHERE id = $1`, [I3]);
  await incident(IY, Y, ownerY, ownerY);
  await q(
    `INSERT INTO security_alerts (id, org_id, kind, severity, window_start, incident_id)
     VALUES ($1, $2, 'login_failures', 'high', '2026-11-08T08:00:00Z', $3)`,
    [ALERT, X, I1],
  );
  await q(
    `INSERT INTO platform_access_logs (id, org_id, operator_user_id, db_login, reason, expires_at)
     VALUES ($1, $2, $3, 'support_test', 'P11b-2b', now() + interval '30 minutes')`,
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

describe('who reads the security incidents (P11b-2b)', () => {
  it('lets an Owner and an Admin read them, and refuses the five other roles before reading', async () => {
    for (const role of ROLES) {
      const res = await get(role, '/v1/security-incidents');
      if (role === 'owner' || role === 'admin') expect(res.status, role).toBe(200);
      else expect(await codeOf(res), role).toEqual([403, 'forbidden']);
    }
  });

  it('lets a platform operator read organisation X through its session, never Y, and still not /v1/customers', async () => {
    const incidents = await idsAt('op', '/v1/security-incidents', SESSION);
    expect(incidents).toEqual([I3, I2, I1]);
    expect(incidents).not.toContain(IY);
    expect(await codeOf(await get('op', '/v1/customers', SESSION))).toEqual([403, 'forbidden']);
    expect((await get('op', '/v1/security-incidents')).status).toBe(403);
  });
});

describe('GET /v1/security-incidents', () => {
  it('answers each incident with its people as id and name, a null name as null (N215), an operator by role (N207 B4)', async () => {
    const [i3, i2, i1] = (await page(await get('owner', '/v1/security-incidents'))).data;
    expect(i3).toMatchObject({
      status: 'closed',
      handler: { id: id('owner'), name: 'Chủ X' },
      openedBy: { id: id('admin'), name: 'Quản trị' },
    });
    expect(i2).toMatchObject({
      id: I2,
      status: 'open',
      handler: { id: id('owner'), name: 'Chủ X' },
      openedBy: { id: id('op'), name: OPERATOR_NAME },
      alertIds: [],
      closedAt: null,
    });
    // A handler who gave no name, an opener no longer an active member: null in the JSON, never a word the server made up.
    expect(i1).toMatchObject({ id: I1, alertIds: [ALERT] });
    expect(i1?.['handler']).toEqual({ id: id('nameless'), name: null });
    expect(i1?.['openedBy']).toEqual({ id: id('gone'), name: null });
    expect(await idsAt('owner', '/v1/security-incidents?status=closed')).toEqual([I3]);
    const first = await page(await get('admin', '/v1/security-incidents?status=open&limit=1'));
    expect(first.data.map((r) => r['id'])).toEqual([I2]);
    const next = `/v1/security-incidents?status=open&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`;
    expect(await idsAt('admin', next)).toEqual([I1]);
    expect((await get('owner', '/v1/security-incidents?cursor=nope')).status).toBe(400);
  });
});
