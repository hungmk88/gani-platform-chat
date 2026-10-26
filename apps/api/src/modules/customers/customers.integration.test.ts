import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// GET /v1/customers and /{id} over HTTP with the real middleware, Better Auth and PostgreSQL (RLS as app_role), N165. Org A has two
// customers; org B one. Phụ lục B: sales see phones and emails whole, marketing masked; nobody sees another organisation's customers.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [orgA, orgB, WA, WB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const [LAN, LAM, THEIRS] = [randomUUID(), randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, org: string, role: string, ws: string, hash: string) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), org, id, role]);
  await q(`INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`, [randomUUID(), org, ws, id]);
}
async function login(key: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${people[key]}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
}
const get = async (key: string, path: string) => {
  const res = await fetch(`${url}${path}`, { headers: { cookie: cookies[key] ?? '' } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const patch = async (key: string, id: string, body: unknown) => {
  const res = await fetch(`${url}/v1/customers/${id}`, {
    method: 'PATCH',
    // A /v1 write with a cookie needs the Origin of the app (N136).
    headers: {
      cookie: cookies[key] ?? '',
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const rows = (body: Record<string, unknown>) => body['data'] as Record<string, unknown>[];
const ids = (body: Record<string, unknown>) => rows(body).map((x) => x['id']);

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: 'http://localhost:3000', APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[WA, orgA], [WB, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  for (const [key, org, role, ws] of [['sales', orgA, 'sales', WA], ['marketing', orgA, 'marketing', WA], ['stranger', orgB, 'manager', WB]] as const)
    await person(key, org, role, ws, hash);
  for (const [id, org, name, phone, email] of [
    [LAN, orgA, 'Nguyễn Thị Lan', '+84912345678', 'lan.nguyen@example.test'],
    [LAM, orgA, 'Trần Văn Lâm', null, null],
    [THEIRS, orgB, 'Lan của B', '+84912999999', null],
  ] as const) {
    await q('INSERT INTO customers (id, org_id, display_name, phone_e164, email) VALUES ($1, $2, $3, $4, $5)', [id, org, name, phone, email]);
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  for (const key of ['sales', 'marketing', 'stranger']) cookies[key] = await login(key);
});

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['audit_logs WHERE org_id', orgs], ['customers WHERE org_id', orgs], ['sessions WHERE user_id', users], ['workspace_members WHERE org_id', orgs],
    ['workspaces WHERE org_id', orgs], ['org_members WHERE org_id', orgs], ['organizations WHERE id', orgs],
    ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET /v1/customers', () => {
  it('gives sales the customers of their organisation with the phone and the email whole, and nothing of another', async () => {
    const res = await get('sales', '/v1/customers');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toContain(LAN);
    expect(ids(res.body)).not.toContain(THEIRS);
    expect(rows(res.body).find((r) => r['id'] === LAN)).toEqual({
      id: LAN,
      displayName: 'Nguyễn Thị Lan',
      phone: '+84912345678',
      email: 'lan.nguyen@example.test',
      humanOnly: false,
      identities: [],
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    });
  });

  it('masks the phone and the email for marketing (Phụ lục B "Che")', async () => {
    const lan = rows((await get('marketing', '/v1/customers')).body).find((r) => r['id'] === LAN);
    expect([lan?.['phone'], lan?.['email']]).toEqual(['+8491*****78', 'l***@example.test']);
  });

  it('finds by a part of the name, or by the start of a number typed the Vietnamese way; marketing never by number', async () => {
    expect(ids((await get('sales', '/v1/customers?q=lan')).body)).toEqual([LAN]);
    expect(ids((await get('sales', '/v1/customers?q=0912%20345')).body)).toEqual([LAN]);
    expect(ids((await get('stranger', '/v1/customers?q=0912')).body)).toEqual([THEIRS]);
    expect(ids((await get('marketing', '/v1/customers?q=0912')).body)).toEqual([]);
  });

  it('refuses a bad query or cursor with 400 validation_failed', async () => {
    for (const query of ['limit=101', 'q=', 'cursor=bm90IG91cnM'])
      expect((await get('sales', `/v1/customers?${query}`)).body['code'], query).toBe(
        'validation_failed',
      );
  });
});

describe('GET /v1/customers/{id}', () => {
  it('gives one customer, masked for marketing', async () => {
    expect((await get('sales', `/v1/customers/${LAN}`)).body).toMatchObject({
      id: LAN,
      phone: '+84912345678',
    });
    expect((await get('marketing', `/v1/customers/${LAN}`)).body).toMatchObject({
      phone: '+8491*****78',
      email: 'l***@example.test',
    });
  });

  it('answers 404 alike for another organisation’s customer and one that does not exist, 400 for a bad id', async () => {
    for (const id of [THEIRS, randomUUID()])
      expect((await get('sales', `/v1/customers/${id}`)).status).toBe(404);
    expect((await get('sales', '/v1/customers/x')).status).toBe(400);
  });
});

describe('PATCH /v1/customers/{id}', () => {
  it('lets sales change the name, the phone typed the Vietnamese way, the email and the flag, and audits the fields only', async () => {
    const res = await patch('sales', LAM, {
      displayName: ' Anh Lâm ',
      phone: '0987 654 321',
      email: 'Lam@Example.Test',
      humanOnly: true,
    });
    expect([
      res.status,
      res.body['displayName'],
      res.body['phone'],
      res.body['email'],
      res.body['humanOnly'],
    ]).toEqual([200, 'Anh Lâm', '+84987654321', 'lam@example.test', true]);
    const audit = await q(
      `SELECT actor_user_id, detail FROM audit_logs WHERE target_id = $1 AND action = 'customer.updated'`,
      [LAM],
    );
    expect(audit.rows).toEqual([
      { actor_user_id: people['sales'], detail: { fields: 'displayName,email,humanOnly,phone' } },
    ]);
    expect(JSON.stringify(audit.rows)).not.toMatch(/987654321|lam@/i);
    expect((await patch('sales', LAM, { phone: null, email: null })).body).toMatchObject({
      phone: null,
      email: null,
    });
  });

  it('refuses marketing (403), another organisation’s customer (404) and a body that is empty, unknown or not a phone (400)', async () => {
    expect((await patch('marketing', LAN, { displayName: 'X' })).status).toBe(403);
    expect((await patch('sales', THEIRS, { displayName: 'X' })).status).toBe(404);
    for (const body of [
      {},
      { name: 'X' },
      { phone: '12ab' },
      { phone: '09123' },
      { email: 'not-an-email' },
      { displayName: '  ' },
    ])
      expect((await patch('sales', LAN, body)).body['code'], JSON.stringify(body)).toBe(
        'validation_failed',
      );
    expect((await get('sales', `/v1/customers/${LAN}`)).body['displayName']).toBe('Nguyễn Thị Lan');
  });
});
