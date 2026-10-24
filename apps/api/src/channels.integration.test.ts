import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// GET /v1/channels (A4, N161) over HTTP with the whole application and PostgreSQL. Org A: an owner and an admin (with a second
// factor) and a manager; workspace W with two channels (one answered by a team, one with a secret) and a deleted one. Org B: a
// workspace with a channel.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, WB, team] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const [oa, chat, gone, ofB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
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
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
async function list(who: string, query: string) {
  const res = await fetch(`${url}/v1/channels${query}`, {
    headers: { cookie: cookies[who] ?? '', origin: ORIGIN },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $3, 'ww', 'W', 'service'), ($2, $4, 'wb', 'WB', 'service')`, [W, WB, orgA, orgB]);
  await q(`INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ($1, $2, $3, 'Sỉ', 'si')`, [team, orgA, W]);
  const insert = `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, oa_secret_key_enc, team_id, deleted_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  const ext = () => `ext-${randomBytes(6).toString('hex')}`;
  await q(insert, [oa, orgA, W, 'zalo_oa', ext(), 'Zalo OA Gani', randomBytes(32), team, null]);
  await q(insert, [chat, orgA, W, 'webchat', ext(), 'Chat web', null, null, null]);
  await q(insert, [gone, orgA, W, 'webchat', ext(), 'Đã gỡ', null, null, new Date()]);
  await q(insert, [ofB, orgB, WB, 'webchat', ext(), 'B', null, null, null]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager']) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['channel_accounts WHERE org_id', [orgA, orgB]], ['teams WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET /v1/channels', () => {
  it('lists the live channels of a workspace by name with their team, and never a secret', async () => {
    const answer = await list('admin', `?workspaceId=${W}`);
    expect(answer.status).toBe(200);
    expect(answer.body['data']).toEqual([
      { id: chat, type: 'webchat', displayName: 'Chat web', status: 'disconnected', teamId: null },
      {
        id: oa,
        type: 'zalo_oa',
        displayName: 'Zalo OA Gani',
        status: 'disconnected',
        teamId: team,
      },
    ]);
    expect(JSON.stringify(answer.body)).not.toMatch(/enc|secret|token/i);
  });

  it('refuses other roles, a workspace of another org and bad requests', async () => {
    const answers = [
      await list('manager', `?workspaceId=${W}`),
      await list('owner', `?workspaceId=${WB}`),
      await list('owner', `?workspaceId=${randomUUID()}`),
      await list('owner', ''),
      await list('owner', `?workspaceId=${W}&teamId=${team}`),
      await list('nobody', `?workspaceId=${W}`),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 404, 404, 400, 400, 401]);
  });
});
