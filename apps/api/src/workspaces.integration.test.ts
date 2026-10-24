import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// GET /v1/workspaces and PATCH /v1/workspaces/{id} (N157) over HTTP with the whole application and PostgreSQL. Org A: an owner, an
// admin (with a second factor), a manager; two workspaces and a deleted one. Org B: one workspace.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB] = [randomUUID(), randomUUID()];
const [sales, service, gone, ofB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, role: string, hash: string) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), orgA, id, role]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[key] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
const list = async (who: string) => {
  const res = await fetch(`${url}/v1/workspaces`, { headers: { cookie: cookies[who] ?? '' } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
async function change(who: string, id: string, body: unknown) {
  const res = await fetch(`${url}/v1/workspaces/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES
    ($1, $5, 'b2b', 'Bán sỉ', 'b2b_sales', NULL), ($2, $5, 'cskh', 'Chăm sóc', 'service', NULL),
    ($3, $5, 'old', 'Cũ', 'service', now()), ($4, $6, 'bb', 'B', 'service', NULL)`, [sales, service, gone, ofB, orgA, orgB]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager']) await person(role, role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['audit_logs WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]], ['sessions WHERE user_id', users],
    ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users], ['users WHERE id', users],
    ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET /v1/workspaces', () => {
  it('lists the workspaces of the organisation by name, never a deleted one; only for an Owner or an Admin', async () => {
    const answer = await list('owner');
    expect(answer.status).toBe(200);
    expect((answer.body['data'] as { id: string }[]).map((w) => w.id)).toEqual([sales, service]);
    expect(answer.body['data']).toContainEqual(
      expect.objectContaining({
        id: sales,
        slug: 'b2b',
        template: 'b2b_sales',
        timezone: 'Asia/Ho_Chi_Minh',
        defaultMaxConcurrent: 5,
      }),
    );
    expect((await list('admin')).status).toBe(200);
    expect((await list('manager')).status).toBe(403);
  });
});

describe('PATCH /v1/workspaces/{id}', () => {
  it('changes the name, the time zone and the default limit, audited with what changed; the same values again write nothing', async () => {
    const res = await change('admin', service, {
      name: '  CSKH miền Bắc ',
      timezone: 'Asia/Bangkok',
    });
    expect(res).toMatchObject({
      status: 200,
      body: { id: service, slug: 'cskh', name: 'CSKH miền Bắc', timezone: 'Asia/Bangkok' },
    });
    expect(
      (await change('owner', service, { name: 'CSKH miền Bắc', defaultMaxConcurrent: 8 })).body,
    ).toMatchObject({ defaultMaxConcurrent: 8 });
    expect((await change('owner', service, { defaultMaxConcurrent: 8 })).status).toBe(200);
    const audit = await q(
      'SELECT actor_user_id, detail FROM audit_logs WHERE target_id = $1 AND action = $2 ORDER BY id',
      [service, 'workspace.updated'],
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: people['admin'],
        detail: {
          nameFrom: 'Chăm sóc',
          nameTo: 'CSKH miền Bắc',
          timezoneFrom: 'Asia/Ho_Chi_Minh',
          timezoneTo: 'Asia/Bangkok',
        },
      },
      {
        actor_user_id: people['owner'],
        detail: { defaultMaxConcurrentFrom: 5, defaultMaxConcurrentTo: 8 },
      },
    ]);
  });

  it('refuses other roles, workspaces of another org, deleted or unknown ones, and anything but the three fields', async () => {
    const answers = [
      await change('manager', sales, { name: 'X' }),
      await change('owner', ofB, { name: 'X' }),
      await change('owner', gone, { name: 'X' }),
      await change('owner', randomUUID(), { name: 'X' }),
      await change('owner', sales, {}),
      await change('owner', sales, { name: '   ' }),
      await change('owner', sales, { timezone: 'Mars/Base' }),
      await change('owner', sales, { defaultMaxConcurrent: 0 }),
      await change('owner', sales, { slug: 'new' }),
      await change('owner', sales, { template: 'service' }),
    ];
    expect(answers.map((a) => a.status)).toEqual([
      403, 404, 404, 404, 400, 400, 400, 400, 400, 400,
    ]);
    const rows = await q(
      'SELECT name, slug, template FROM workspaces WHERE id = ANY($1::uuid[]) ORDER BY slug',
      [[sales, ofB]],
    );
    expect(rows.rows).toEqual([
      { name: 'Bán sỉ', slug: 'b2b', template: 'b2b_sales' },
      { name: 'B', slug: 'bb', template: 'service' },
    ]);
  });
});
