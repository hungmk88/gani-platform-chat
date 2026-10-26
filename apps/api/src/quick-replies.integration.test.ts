import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// /v1/quick-replies (C7, N163) over HTTP with the whole application and PostgreSQL. Org A: an owner (with a second factor), a manager, a
// sales and a marketing, all in workspace W; W2 has nobody of them but a template. Org B: a workspace.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, W2, WB, inW2] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(role: string, hash: string) {
  const id = (people[role] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), orgA, id, role]);
  await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [randomUUID(), orgA, W, id]);
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
async function call(who: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await fetch(`${url}/v1/quick-replies${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookies[who] ?? '',
      origin: ORIGIN,
      ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}
const shortcuts = (a: Answer) => (a.body['data'] as { shortcut: string }[]).map((t) => t.shortcut);

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $4, 'ww', 'W', 'service'), ($2, $4, 'w2', 'W2', 'service'), ($3, $5, 'wb', 'WB', 'service')`, [W, W2, WB, orgA, orgB]);
  await q(`INSERT INTO quick_replies (id, org_id, workspace_id, shortcut, body) VALUES ($1, $2, $3, 'khac', 'Ở W2')`, [inW2, orgA, W2]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'manager', 'sales', 'marketing']) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['quick_replies WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/quick-replies', () => {
  it('lets a Manager make templates that a Sales finds by shortcut or tag, most used first', async () => {
    const made = await call('manager', 'POST', '', {
      workspaceId: W,
      shortcut: 'chao',
      body: 'Chào {{customer_name}}, em là {{ agent_name }} của {{company_name}}',
      tags: ['mo-dau'],
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      workspaceId: W,
      shortcut: 'chao',
      tags: ['mo-dau'],
      useCount: 0,
    });
    await call('owner', 'POST', '', {
      workspaceId: W,
      shortcut: 'bao-gia',
      body: 'Gọi {{company_phone}}',
      tags: ['gia'],
    });
    await q(
      `UPDATE quick_replies SET use_count = 5 WHERE shortcut = 'bao-gia' AND workspace_id = $1`,
      [W],
    );
    expect(shortcuts(await call('sales', 'GET', `?workspaceId=${W}`))).toEqual(['bao-gia', 'chao']);
    expect(shortcuts(await call('sales', 'GET', `?workspaceId=${W}&q=ch`))).toEqual(['chao']);
    expect(shortcuts(await call('sales', 'GET', `?workspaceId=${W}&tag=gia`))).toEqual(['bao-gia']);
  });

  it('keeps shortcuts unique in a workspace', async () => {
    expect(
      (await call('manager', 'POST', '', { workspaceId: W, shortcut: 'cam-on', body: 'Cảm ơn' }))
        .status,
    ).toBe(201);
    const taken = await call('manager', 'POST', '', {
      workspaceId: W,
      shortcut: 'cam-on',
      body: 'Lần hai',
    });
    expect([taken.status, taken.body['code']]).toEqual([409, 'duplicate_resource']);
  });

  it('refuses other roles, workspaces of others, and bodies with variables that are not of Đợt 1', async () => {
    const answers = [
      await call('sales', 'POST', '', { workspaceId: W, shortcut: 's', body: 'X' }),
      await call('marketing', 'GET', `?workspaceId=${W}`),
      await call('owner', 'GET', `?workspaceId=${W2}`),
      await call('owner', 'GET', `?workspaceId=${WB}`),
      await call('owner', 'POST', '', { workspaceId: W2, shortcut: 'x', body: 'X' }),
      await call('owner', 'POST', '', { workspaceId: W, shortcut: 'gia', body: 'Giá {{price_1}}' }),
      await call('owner', 'POST', '', { workspaceId: W, shortcut: 'Có Dấu', body: 'X' }),
      await call('owner', 'POST', '', { workspaceId: W, shortcut: 'rong', body: '   ' }),
      await call('owner', 'POST', '', {
        workspaceId: W,
        shortcut: 'tag',
        body: 'X',
        tags: ['a', 'a'],
      }),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 403, 404, 404, 404, 400, 400, 400, 400]);
    const there = await q(
      'SELECT shortcut FROM quick_replies WHERE workspace_id = ANY($1::uuid[]) ORDER BY shortcut',
      [[W2, WB]],
    );
    expect(there.rows).toEqual([{ shortcut: 'khac' }]);
  });
});

describe('PATCH/DELETE /v1/quick-replies/{id}', () => {
  it('changes and ends a template, and gives an ended shortcut back', async () => {
    const id = String(
      (
        await call('manager', 'POST', '', {
          workspaceId: W,
          shortcut: 'tam-biet',
          body: 'Tạm biệt',
        })
      ).body['id'],
    );
    expect((await call('manager', 'PATCH', `/${id}`, { shortcut: 'chao' })).body['code']).toBe(
      'duplicate_resource',
    );
    expect(
      (
        await call('manager', 'PATCH', `/${id}`, {
          body: 'Tạm biệt {{customer_name}}',
          tags: ['cuoi'],
        })
      ).body,
    ).toMatchObject({
      shortcut: 'tam-biet',
      body: 'Tạm biệt {{customer_name}}',
      tags: ['cuoi'],
    });
    expect((await call('owner', 'DELETE', `/${id}`)).status).toBe(204);
    expect((await call('owner', 'DELETE', `/${id}`)).status).toBe(404);
    expect(
      (await call('manager', 'POST', '', { workspaceId: W, shortcut: 'tam-biet', body: 'Mới' }))
        .status,
    ).toBe(201);
  });

  it('refuses other roles, a template of another workspace, and bad changes, and leaves it as it was', async () => {
    const mine = String(
      (await call('owner', 'POST', '', { workspaceId: W, shortcut: 'giu', body: 'Giữ' })).body[
        'id'
      ],
    );
    const answers = [
      await call('sales', 'PATCH', `/${mine}`, { body: 'Đổi' }),
      await call('sales', 'DELETE', `/${mine}`),
      await call('owner', 'PATCH', `/${inW2}`, { body: 'Đổi' }),
      await call('owner', 'DELETE', `/${inW2}`),
      await call('owner', 'PATCH', `/${mine}`, {}),
      await call('owner', 'PATCH', `/${mine}`, { body: '{{price_1}}' }),
      await call('owner', 'PATCH', `/${mine}`, { workspaceId: W2 }),
      await call('owner', 'PATCH', '/not-a-uuid', { body: 'X' }),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 403, 404, 404, 400, 400, 400, 400]);
    const rows = await q(
      'SELECT id, body, deleted_at IS NULL AS live FROM quick_replies WHERE id = ANY($1::uuid[]) ORDER BY body',
      [[mine, inW2]],
    );
    expect(rows.rows).toEqual([
      { id: mine, body: 'Giữ', live: true },
      { id: inW2, body: 'Ở W2', live: true },
    ]);
  });
});
