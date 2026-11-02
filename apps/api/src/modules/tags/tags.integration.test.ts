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

// /v1/tags (Tag 3a, N190) over HTTP with the whole application and PostgreSQL. Org A: an owner and an admin (with a second factor), a
// manager and a marketing, and two customers; org B: a tag.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, tagB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const customers = [uuidv7(), uuidv7()];
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
type Tag = { id: string; name: string; hidden: boolean; customerCount: number };
type Answer = { status: number; body: Record<string, unknown> };
async function call(
  who: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${url}${path.startsWith('/v1/') ? '' : '/v1/tags'}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookies[who] ?? '',
      origin: ORIGIN,
      ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const answer: Answer = {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
  return answer;
}
const make = (name: string, who = 'owner') => call(who, 'POST', '', { name });
const names = async () =>
  ((await call('marketing', 'GET', '')).body['data'] as Tag[]).map((t) => [
    t.name,
    t.customerCount,
  ]);

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ww', 'W', 'service')`, [W, orgA]);
  for (const c of customers) await q('INSERT INTO customers (id, org_id) VALUES ($1, $2)', [c, orgA]);
  await q(`INSERT INTO tags (id, org_id, name) VALUES ($1, $2, 'Của B')`, [tagB, orgB]);
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
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['audit_logs WHERE org_id', [orgA, orgB]],
    ['customer_tags WHERE org_id', [orgA, orgB]], ['tags WHERE org_id', [orgA, orgB]], ['customers WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/tags', () => {
  it('lets an Owner or an Admin make a tag, one name whatever the case, and every role read them', async () => {
    const vip = await make('  VIP ');
    expect(vip).toMatchObject({
      status: 201,
      body: { name: 'VIP', hidden: false, customerCount: 0 },
    });
    expect((await make('Bán sỉ', 'admin')).status).toBe(201);
    expect(await make('vip')).toMatchObject({ status: 409, body: { code: 'duplicate_resource' } });
    expect((await make('')).status).toBe(400);
    expect((await make('Khác', 'manager')).status).toBe(403);
    expect(await names()).toEqual([
      ['Bán sỉ', 0],
      ['VIP', 0],
    ]);
  });

  it('renames and hides a tag of the company only', async () => {
    const id = ((await make('Cũ')).body as Tag).id;
    const changed = await call('admin', 'PATCH', `/${id}`, { name: 'Mới', hidden: true });
    expect(changed).toMatchObject({ status: 200, body: { name: 'Mới', hidden: true } });
    expect((await call('owner', 'PATCH', `/${id}`, {})).status).toBe(400);
    expect((await call('owner', 'PATCH', `/${id}`, { name: 'VIP' })).status).toBe(409);
    expect((await call('manager', 'PATCH', `/${id}`, { hidden: false })).status).toBe(403);
    expect((await call('owner', 'PATCH', `/${tagB}`, { hidden: true })).status).toBe(404);
  });

  it('merges a tag into another: its customers move, the source is gone, the merge is audited', async () => {
    const [from, into] = [
      ((await make('Nguồn')).body as Tag).id,
      ((await make('Đích')).body as Tag).id,
    ];
    for (const [c, t] of [
      [customers[0], from],
      [customers[1], from],
      [customers[1], into],
    ])
      await q(
        'INSERT INTO customer_tags (id, org_id, customer_id, tag_id) VALUES ($1, $2, $3, $4)',
        [uuidv7(), orgA, c, t],
      );
    expect((await call('owner', 'POST', `/${from}/merge`, { intoTagId: from })).status).toBe(400);
    expect((await call('owner', 'POST', `/${from}/merge`, { intoTagId: tagB })).status).toBe(404);
    expect((await call('manager', 'POST', `/${from}/merge`, { intoTagId: into })).status).toBe(403);
    const merged = await call('owner', 'POST', `/${from}/merge`, { intoTagId: into });
    expect(merged).toMatchObject({
      status: 200,
      body: { movedCount: 1, into: { id: into, customerCount: 2 } },
    });
    expect((await names()).map(([n]) => n)).not.toContain('Nguồn');
    const audit = await q(
      `SELECT detail FROM audit_logs WHERE org_id = $1 AND action = 'tag.merged' AND target_id = $2`,
      [orgA, from],
    );
    expect(audit.rows).toEqual([{ detail: { intoTagId: into, movedCount: 1 } }]);
  });

  it("sets a customer's tags (editors only, existing ones, no new hidden one), shows them and filters by them", async () => {
    const [vip, si, an] = await Promise.all(
      ['K VIP', 'K Sỉ', 'K Ẩn'].map(async (n) => ((await make(n)).body as Tag).id),
    );
    await call('owner', 'PATCH', `/${an}`, { hidden: true });
    const put = (who: string, ids: string[], c = customers[0]) =>
      call(who, 'PUT', `/v1/customers/${c}/tags`, { tagIds: ids });
    expect(await put('manager', [si!, vip!])).toMatchObject({
      status: 200,
      body: { data: [{ name: 'K Sỉ' }, { name: 'K VIP' }] },
    });
    expect((await put('marketing', [vip!])).status).toBe(403);
    expect(await put('owner', [an!])).toMatchObject({ status: 422, body: { code: 'tag_hidden' } });
    expect((await put('owner', [tagB])).status).toBe(404);
    expect((await put('owner', [], uuidv7())).status).toBe(404);
    expect((await put('owner', [vip!, vip!])).status).toBe(400);
    const page = await call('marketing', 'GET', `/v1/customers?tagId=${si}`);
    expect((page.body['data'] as { id: string }[]).map((c) => c.id)).toEqual([customers[0]]);
    const one = await call('marketing', 'GET', `/v1/customers/${customers[0]}`);
    expect((one.body['tags'] as Tag[]).map((t) => t.name)).toEqual(['K Sỉ', 'K VIP']);
  });
});
