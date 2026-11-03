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

// /v1/customer-fields (Tag 3b-ii, N191) over HTTP with the whole application and PostgreSQL. Org A: an owner and an admin (with a
// second factor), a manager and a marketing, and a customer; org B: a field.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, fieldB, customer] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
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
type Field = { id: string; name: string; type: string; options: string[]; position: number };
type Answer = { status: number; body: Record<string, unknown> };
async function call(who: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await fetch(`${url}/v1/customer-fields${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}
const make = (body: Record<string, unknown>, who = 'owner') => call(who, 'POST', '', body);
const idOf = (a: Answer) => (a.body as Field).id;
const list = async (who = 'marketing') => (await call(who, 'GET', '')).body['data'] as Field[];
const valueFor = (field: string) =>
  q(
    `INSERT INTO customer_field_values (id, org_id, customer_id, field_id, value) VALUES ($1, $2, $3, $4, '"Hộp"')`,
    [uuidv7(), orgA, customer, field],
  );
type Audit = { action: string; detail: Record<string, string>; actor: string | null };
const audits = async (target: string): Promise<Audit[]> =>
  (
    await q(
      'SELECT action, detail, actor_user_id AS actor FROM audit_logs WHERE org_id = $1 AND target_id = $2 ORDER BY id',
      [orgA, target],
    )
  ).rows as Audit[];

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ww', 'W', 'service')`, [W, orgA]);
  await q('INSERT INTO customers (id, org_id) VALUES ($1, $2)', [customer, orgA]);
  await q(`INSERT INTO customer_field_defs (id, org_id, name, type) VALUES ($1, $2, 'Của B', 'text')`, [fieldB, orgB]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager', 'marketing']) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['audit_logs WHERE org_id', [orgA, orgB]], ['customer_field_values WHERE org_id', [orgA, orgB]],
    ['customer_field_defs WHERE org_id', [orgA, orgB]], ['customers WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/customer-fields', () => {
  it('lets an Owner or an Admin define fields, last in the order, audited, and every role of the company read them', async () => {
    const zone = await make({ name: ' Khu vực ', type: 'select', options: ['Bắc', 'Nam'] });
    const tax = await make({ name: 'MST', type: 'text', sensitive: true, required: true }, 'admin');
    expect([zone.status, tax.status]).toEqual([201, 201]);
    expect(zone.body).toMatchObject({ name: 'Khu vực', type: 'select', options: ['Bắc', 'Nam'] });
    expect(zone.body).toMatchObject({ required: false, sensitive: false, hidden: false });
    expect(tax.body).toMatchObject({
      sensitive: true,
      required: true,
      options: [],
      hasData: false,
    });
    expect((tax.body as Field).position).toBe((zone.body as Field).position + 1);
    for (const bad of [
      { name: 'Hạng', type: 'select' },
      { name: 'Hạng', type: 'text', options: ['A', 'B'] },
      { name: 'Hạng', type: 'select', options: ['A'] },
      { name: '  ', type: 'text' },
      { name: 'Hạng', type: 'color' },
    ])
      expect((await make(bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await make({ name: 'Hạng', type: 'text' }, 'manager')).status).toBe(403);
    for (const who of ['owner', 'manager', 'marketing'])
      expect((await list(who)).map((f) => f.name)).toEqual(['Khu vực', 'MST']);
    expect(await audits(idOf(zone))).toEqual([
      { action: 'customer_field.created', detail: { type: 'select' }, actor: people['owner'] },
    ]);
  });

  it('changes a field: choices follow the type, a field with data keeps its type and ends only hidden', async () => {
    const pack = idOf(await make({ name: 'Đóng gói', type: 'select', options: ['Hộp', 'Thùng'] }));
    const patch = (body: unknown, who = 'owner', id = pack) => call(who, 'PATCH', `/${id}`, body);
    expect(await patch({ type: 'multiselect' })).toMatchObject({
      status: 200,
      body: { type: 'multiselect', options: ['Hộp', 'Thùng'] },
    });
    expect((await patch({ options: ['A', 'B'], type: 'text' })).status).toBe(400);
    expect(await patch({ type: 'text' })).toMatchObject({ status: 200, body: { options: [] } });
    expect((await patch({ type: 'select' })).status).toBe(400);
    expect((await patch({ options: ['A', 'B'] })).status).toBe(400);
    expect(
      await patch({ type: 'select', options: ['Hộp', 'Thùng', 'Bao'], name: 'Bao bì' }, 'admin'),
    ).toMatchObject({ status: 200, body: { name: 'Bao bì', options: ['Hộp', 'Thùng', 'Bao'] } });
    expect((await patch({ hidden: true }, 'manager')).status).toBe(403);
    expect((await patch({})).status).toBe(400);
    await valueFor(pack);
    const refused = [{ type: 'text' }, { sensitive: true }, { options: ['Thùng', 'Bao'] }];
    for (const go of [
      ...refused.map((b) => () => patch(b)),
      () => call('owner', 'DELETE', `/${pack}`),
    ])
      expect(await go()).toMatchObject({ status: 409, body: { code: 'field_has_data' } });
    expect(await patch({ options: ['Hộp', 'Thùng'] })).toMatchObject({ body: { hasData: true } });
    expect(await patch({ hidden: true })).toMatchObject({ status: 200, body: { hidden: true } });
    expect((await audits(pack)).map((a) => [a.action, a.detail])).toEqual([
      ['customer_field.created', { type: 'select' }],
      ['customer_field.updated', { fields: 'type' }],
      ['customer_field.updated', { fields: 'type' }],
      ['customer_field.updated', { fields: 'name,type,options' }],
      ['customer_field.updated', { fields: 'options' }],
      ['customer_field.updated', { fields: 'hidden' }],
    ]);
  });

  it('ends a field without data, and answers 404 for an ended field or one of another company', async () => {
    const spare = idOf(await make({ name: 'Bỏ', type: 'number' }));
    expect((await call('manager', 'DELETE', `/${spare}`)).status).toBe(403);
    expect((await call('admin', 'DELETE', `/${spare}`)).status).toBe(204);
    expect((await list()).map((f) => f.id)).not.toContain(spare);
    expect((await audits(spare)).map((a) => [a.action, a.detail])).toEqual([
      ['customer_field.created', { type: 'number' }],
      ['customer_field.deleted', {}],
    ]);
    for (const id of [spare, fieldB]) {
      expect((await call('owner', 'PATCH', `/${id}`, { name: 'X' })).status).toBe(404);
      expect((await call('owner', 'DELETE', `/${id}`)).status).toBe(404);
    }
    expect((await call('owner', 'DELETE', '/not-a-uuid')).status).toBe(400);
    expect((await list()).map((f) => f.id)).not.toContain(fieldB);
  });

  it('stops at 50 live fields: the 51st is 422 field_limit_reached', async () => {
    const live = (await list()).length;
    await q(
      `INSERT INTO customer_field_defs (id, org_id, name, type) SELECT id, $2, 'Lô ' || n, 'text' FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`,
      [Array.from({ length: 49 - live }, () => uuidv7()), orgA],
    );
    expect((await make({ name: 'Thứ 50', type: 'text' })).status).toBe(201);
    expect(await make({ name: 'Thứ 51', type: 'text' })).toMatchObject({
      status: 422,
      body: { code: 'field_limit_reached' },
    });
    expect(await list()).toHaveLength(50);
  });
});
