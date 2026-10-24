import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// /v1/teams (A4, N160) over HTTP with the whole application and PostgreSQL. Org A: an owner, an admin (with a second factor), a
// manager and a sales agent, all in workspace W; an outsider of org A not in W. Org B: a workspace with a team.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, WB, teamB] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const memberOf: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, role: string, hash: string, inW = true) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [(memberOf[key] = randomUUID()), orgA, id, role]);
  if (inW) await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [randomUUID(), orgA, W, id]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[key] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
type Answer = { status: number; body: Record<string, unknown> };
async function call(
  who: string,
  method: string,
  path: string,
  body?: unknown,
  key?: string,
): Promise<Answer> {
  const res = await fetch(`${url}/v1/teams${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookies[who] ?? '',
      origin: ORIGIN,
      ...(method === 'POST' ? { 'idempotency-key': key ?? randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}
const make = (name: string) => call('owner', 'POST', '', { workspaceId: W, name });
const audits = async (id: string) =>
  (await q('SELECT action, detail FROM audit_logs WHERE target_id = $1 ORDER BY id', [id]))
    .rows as unknown[];

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $3, 'ww', 'W', 'service'), ($2, $4, 'wb', 'WB', 'service')`, [W, WB, orgA, orgB]);
  await q(`INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ($1, $2, $3, 'B', 'bb')`, [teamB, orgB, WB]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager', 'sales']) await person(role, role, hash);
  await person('outsider', 'sales', hash, false);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['audit_logs WHERE org_id', [orgA, orgB]], ['team_members WHERE org_id', [orgA, orgB]],
    ['teams WHERE org_id', [orgA, orgB]], ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET/POST /v1/teams', () => {
  it('makes teams with slugs from the name, audited, and lists them by name', async () => {
    const [one, two] = [await make('Bán sỉ'), await make('Bán sỉ')];
    expect([one.status, one.body['slug'], two.body['slug']]).toEqual([201, 'ban-si', 'ban-si-2']);
    expect(
      (
        await call('owner', 'POST', '', {
          workspaceId: W,
          name: ' Kho ',
          description: ' Giao hàng ',
        })
      ).body,
    ).toMatchObject({ name: 'Kho', description: 'Giao hàng', isDefault: false, memberCount: 0 });
    const list = await call('admin', 'GET', `?workspaceId=${W}`);
    expect((list.body['data'] as { name: string }[]).map((t) => t.name)).toEqual([
      'Bán sỉ',
      'Bán sỉ',
      'Kho',
    ]);
    expect(await audits(String(two.body['id']))).toEqual([
      { action: 'team.created', detail: { slug: 'ban-si-2' } },
    ]);
    // A Manager reads only the teams they are in: none yet.
    expect((await call('manager', 'GET', `?workspaceId=${W}`)).body['data']).toEqual([]);
  });

  it('refuses other roles, workspaces of another org and bad requests', async () => {
    const answers = [
      await call('manager', 'POST', '', { workspaceId: W, name: 'M' }),
      await call('sales', 'GET', `?workspaceId=${W}`),
      await call('owner', 'GET', `?workspaceId=${WB}`),
      await call('owner', 'POST', '', { workspaceId: WB, name: 'X' }),
      await call('owner', 'POST', '', { workspaceId: W, name: '  ' }),
      await call('owner', 'POST', '', { workspaceId: W, name: 'S', slug: 's' }),
      await call('owner', 'GET', ''),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 403, 404, 404, 400, 400, 400]);
    const b = await q('SELECT count(*)::int AS n FROM teams WHERE workspace_id = $1', [WB]);
    expect(b.rows[0]).toEqual({ n: 1 });
  });
});
