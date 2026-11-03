import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { SecretBox } from '@gani/channels';
import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// /v1/customers/{id}/fields (Tag 3b-iii, N191) over HTTP with the whole application and PostgreSQL. Org A: an owner (with a second
// factor), a sales and a marketing, a customer and five fields (a sensitive one, a hidden one); org B: a customer and a field. The
// application seals with a key of this test; a second one, without any key, answers 503 for a sensitive value only.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const six = () => [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()] as const;
const [orgA, orgB, W, customer, customerB, plain] = six();
const [zone, account, phone, note, old, fieldB] = six();
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
const apps: NestExpressApplication[] = [];
let [url, keyless] = ['', ''];
const q = (text: string, params: unknown[]) => admin.query(text, params);

async function serve(withoutKeys = false): Promise<string> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (withoutKeys) builder.overrideProvider(SecretBox).useValue(new SecretBox(new Map()));
  const nest = (await builder.compile()).createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  apps.push(nest);
  return nest.getUrl();
}
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
  if (role === 'owner') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
type Answer = { status: number; body: Record<string, unknown> };
async function call(who: string, method: string, id = customer, values?: unknown, at = url) {
  const res = await fetch(`${at}/v1/customers/${id}/fields`, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN },
    ...(values === undefined ? {} : { body: JSON.stringify({ values }) }),
  });
  const answer: Answer = {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
  return answer;
}
const put = (who: string, values: unknown, id = customer, at = url) =>
  call(who, 'PUT', id, values, at);
const stored = async (field: string) =>
  (
    await q(
      'SELECT id, value, value_enc AS enc, key_version AS kv FROM customer_field_values WHERE field_id = $1',
      [field],
    )
  ).rows as { id: string; value: unknown; enc: Buffer | null; kv: number | null }[];

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true', CHANNEL_SECRET_KEY_3: randomBytes(32).toString('hex') });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ww', 'W', 'service')`, [W, orgA]);
  await q('INSERT INTO customers (id, org_id) VALUES ($1, $2), ($3, $4), ($5, $2)', [customer, orgA, customerB, orgB, plain]);
  for (const [id, org, name, type, options, sensitive, hidden, position] of [
    [zone, orgA, 'Khu vực', 'select', ['Bắc', 'Nam'], false, false, 0], [account, orgA, 'Số tài khoản', 'text', [], true, false, 1],
    [phone, orgA, 'SĐT kho', 'phone', [], false, false, 2], [note, orgA, 'Ghi chú cũ', 'text', [], false, true, 3],
    [old, orgA, 'Đã bỏ', 'text', [], false, false, 4], [fieldB, orgB, 'Của B', 'text', [], false, false, 0],
  ] as const)
    await q('INSERT INTO customer_field_defs (id, org_id, name, type, options, sensitive, hidden, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, org, name, type, options, sensitive, hidden, position]);
  await q('UPDATE customer_field_defs SET deleted_at = now() WHERE id = $1', [old]);
  [url, keyless] = [await serve(), await serve(true)];
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'sales', 'marketing']) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  for (const nest of apps) await nest.close();
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

describe('/v1/customers/{id}/fields', () => {
  it('lets an editor set values, normalised, a sensitive one only sealed, audited by id; Marketing reads it masked', async () => {
    const set = await put('sales', [
      { fieldId: account, value: '0123456789' },
      { fieldId: zone, value: 'Bắc' },
      { fieldId: phone, value: '0912 345 678' },
      { fieldId: note, value: 'ẩn vẫn nhận' },
    ]);
    const all = [
      { fieldId: zone, value: 'Bắc' },
      { fieldId: account, value: '0123456789' },
      { fieldId: phone, value: '+84912345678' },
      { fieldId: note, value: 'ẩn vẫn nhận' },
    ];
    expect(set).toEqual({ status: 200, body: { data: all } });
    const [sealed] = await stored(account);
    expect(sealed).toMatchObject({ value: null, kv: 3 });
    expect(sealed!.enc!.toString('latin1')).not.toContain('0123456789');
    expect((await call('owner', 'GET')).body).toEqual({ data: all });
    expect((await call('marketing', 'GET')).body['data']).toContainEqual({
      fieldId: account,
      value: '••••',
    });
    const audit = await q(
      `SELECT detail, actor_user_id AS actor FROM audit_logs WHERE org_id = $1 AND action = 'customer.fields_changed'`,
      [orgA],
    );
    expect(audit.rows).toEqual([
      { detail: { fieldIds: [account, zone, phone, note].join(',') }, actor: people['sales'] },
    ]);
    // Cleared: the row stays, every column NULL, the value gone from what the API gives.
    expect((await put('owner', [{ fieldId: note, value: null }])).body['data']).toHaveLength(3);
    expect(await stored(note)).toMatchObject([{ value: null, enc: null, kv: null }]);
  });

  it('refuses a role that does not edit, a value that does not fit, a field or a customer not of the company', async () => {
    expect((await put('marketing', [{ fieldId: zone, value: 'Nam' }])).status).toBe(403);
    for (const value of ['Tây', ['Bắc'], 7])
      expect(await put('owner', [{ fieldId: zone, value }])).toMatchObject({
        status: 422,
        body: { code: 'invalid_field_value' },
      });
    expect(await stored(zone)).toMatchObject([{ value: 'Bắc' }]);
    for (const field of [fieldB, old])
      expect((await put('owner', [{ fieldId: field, value: 'x' }])).status).toBe(404);
    for (const id of [customerB, uuidv7()]) {
      expect((await put('owner', [{ fieldId: zone, value: 'Nam' }], id)).status).toBe(404);
      expect((await call('owner', 'GET', id)).status).toBe(404);
    }
    const twice = [zone, zone].map((fieldId) => ({ fieldId, value: 'Nam' }));
    expect((await put('owner', twice)).status).toBe(400);
    expect((await put('owner', [])).status).toBe(400);
    expect((await call('owner', 'GET', 'not-a-uuid')).status).toBe(400);
  });

  it('without a key, answers 503 to what must seal or open a sensitive value (nothing written), and serves the rest', async () => {
    const unavailable = { status: 503, body: { code: 'service_unavailable' } };
    expect(await put('owner', [{ fieldId: account, value: '1' }], customer, keyless)).toMatchObject(
      unavailable,
    );
    expect(await call('owner', 'GET', customer, undefined, keyless)).toMatchObject(unavailable);
    expect((await put('sales', [{ fieldId: zone, value: 'Nam' }], customer, keyless)).status).toBe(
      503,
    );
    expect(await put('sales', [{ fieldId: zone, value: 'Nam' }], plain, keyless)).toEqual({
      status: 200,
      body: { data: [{ fieldId: zone, value: 'Nam' }] },
    });
    expect((await call('marketing', 'GET', customer, undefined, keyless)).body['data']).toEqual([
      { fieldId: zone, value: 'Bắc' },
      { fieldId: account, value: '••••' },
      { fieldId: phone, value: '+84912345678' },
    ]);
  });
});
