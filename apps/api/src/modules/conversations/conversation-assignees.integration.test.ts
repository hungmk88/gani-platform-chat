import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// GET /v1/conversations/{id}/assignees (U31, N168) over HTTP with the real middleware, Better Auth and PostgreSQL (RLS as app_role), and
// against the actions it reads ahead: whoever it leaves out, transfer or assign refuses; whoever it lists, they accept. Org A, W1: a
// manager, sales and teammate (one team), colleague (no team), marketing and a suspended sales; elsewhere is in W2 only; org B a stranger.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W1, W2, WB, TEAM, ALPHA] = Array.from({ length: 7 }, () => randomUUID()) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const PW = randomBytes(18).toString('base64url');
const CAST = [
  'manager',
  'sales',
  'teammate',
  'multi',
  'colleague',
  'marketing',
  'suspended',
  'elsewhere',
  'stranger',
] as const;
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const c: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, org: string, role: string, ws: string, hash: string, status = 'active') {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), $3)`, [id, `${id}@example.test`, key]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), org, id, role, status]);
  await q(`INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`, [randomUUID(), org, ws, id]);
}
// prettier-ignore
async function conversation(key: string, state: string, assigned: string | null, org = orgA, ws = W1) {
  c[key] = randomUUID();
  await q(`INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id) VALUES ($1, $2, $3, $4, $5)`, [c[key], org, ws, state, assigned]);
}
async function login(key: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${people[key]}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
}
type Answer = { status: number; body: Record<string, unknown> };
async function list(who: string, conv: string, purpose: string): Promise<Answer> {
  const res = await fetch(`${url}/v1/conversations/${c[conv]}/assignees?purpose=${purpose}`, {
    headers: { cookie: cookies[who] ?? '' },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const ids = (a: Answer) => (a.body['data'] as { userId: string }[]).map((p) => p.userId);
const keysOf = (a: Answer) => ids(a).map((id) => Object.keys(people).find((k) => people[k] === id));
async function act(who: string, conv: string, action: string, to: string): Promise<number> {
  const { rows } = await q('SELECT version FROM conversations WHERE id = $1', [c[conv]]);
  const res = await fetch(`${url}/v1/conversations/${c[conv]}/${action}`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN, 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      version: (rows[0] as { version: number }).version,
      toUserId: people[to],
    }),
  });
  return res.status;
}

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[W1, orgA], [W2, orgA], [WB, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  for (const [key, org, role, ws, status] of [['manager', orgA, 'manager', W1], ['sales', orgA, 'sales', W1], ['teammate', orgA, 'support', W1], ['multi', orgA, 'support', W1], ['colleague', orgA, 'sales', W1], ['marketing', orgA, 'marketing', W1], ['suspended', orgA, 'sales', W1, 'suspended'], ['elsewhere', orgA, 'sales', W2], ['stranger', orgB, 'manager', WB]] as const)
    await person(key, org, role, ws, hash, status);
  // multi is in Team A (shared with sales) and in Alpha (first by name, shared with nobody); manager and colleague are in no team.
  for (const [team, name] of [[TEAM, 'Team A'], [ALPHA, 'Alpha']] as const)
    await q(`INSERT INTO teams (id, org_id, workspace_id, name, slug) VALUES ($1, $2, $3, $4, $5)`, [team, orgA, W1, name, `t-${team}`]);
  for (const [team, key] of [[TEAM, 'sales'], [TEAM, 'teammate'], [TEAM, 'multi'], [ALPHA, 'multi']] as const)
    await q('INSERT INTO team_members (id, org_id, team_id, user_id) VALUES ($1, $2, $3, $4)', [randomUUID(), orgA, team, people[key]]);
  await q(`INSERT INTO agent_settings (id, org_id, user_id, max_concurrent_conversations) VALUES ($1, $2, $3, 3)`, [randomUUID(), orgA, people['teammate']]);
  await conversation('mine', 'HUMAN_ACTIVE', people['sales'] as string);
  await conversation('theirs', 'HUMAN_ACTIVE', people['colleague'] as string);
  await conversation('queued', 'HUMAN_WAITING_Q', null);
  await conversation('waiting', 'PENDING_CUSTOMER', people['multi'] as string);
  await conversation('elsewhere', 'HUMAN_ACTIVE', people['teammate'] as string, orgA, W2);
  await conversation('otherOrg', 'HUMAN_WAITING_Q', null, orgB, WB);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  for (const key of ['manager', 'sales', 'marketing']) cookies[key] = await login(key);
}, 120_000);

// Children first (foreign keys). A failing step is swallowed: the CI database is thrown away after the job.
// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['outbox_events WHERE org_id', orgs], ['conversation_events WHERE org_id', orgs], ['conversations WHERE org_id', orgs],
    ['idempotency_keys WHERE org_id', orgs], ['audit_logs WHERE org_id', orgs], ['agent_settings WHERE org_id', orgs],
    ['team_members WHERE org_id', orgs], ['teams WHERE org_id', orgs], ['sessions WHERE user_id', users],
    ['workspace_members WHERE org_id', orgs], ['workspaces WHERE org_id', orgs], ['org_members WHERE org_id', orgs],
    ['organizations WHERE id', orgs], ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET /v1/conversations/{id}/assignees', () => {
  it('Sales transferring one they hold: only who shares a team with them, with team, held count and limit', async () => {
    const a = await list('sales', 'mine', 'transfer');
    expect(a.status).toBe(200);
    expect(a.body['data']).toEqual([
      {
        userId: people['multi'],
        name: 'multi',
        role: 'support',
        teamId: TEAM,
        teamName: 'Team A',
        openCount: 0,
        awaitingCustomerCount: 1,
        maxConcurrent: 5,
      },
      {
        userId: people['teammate'],
        name: 'teammate',
        role: 'support',
        teamId: TEAM,
        teamName: 'Team A',
        openCount: 1,
        awaitingCustomerCount: 0,
        maxConcurrent: 3,
      },
    ]);
  });

  it('Manager: the whole workspace for assign and for transfer, never the holder, a role that cannot hold, suspended or elsewhere', async () => {
    for (const purpose of ['assign', 'transfer']) {
      const a = await list('manager', 'theirs', purpose);
      expect(a.status).toBe(200);
      expect(keysOf(a)).toEqual(['manager', 'multi', 'sales', 'teammate']);
      // The answer carries the count by state (Brief §M04): multi holds one conversation waiting for the customer, none active.
      const multi = (a.body['data'] as Record<string, unknown>[]).find(
        (p) => p['userId'] === people['multi'],
      );
      expect(multi).toMatchObject({ openCount: 0, awaitingCustomerCount: 1 });
    }
  });

  it('names each person’s team: the one shared with the caller, else the first by name, else null', async () => {
    const teams = async (
      who: string,
      conv: string,
      purpose: string,
    ): Promise<Record<string, string | null>> =>
      Object.fromEntries(
        (
          (await list(who, conv, purpose)).body['data'] as {
            userId: string;
            teamName: string | null;
          }[]
        ).map((p): [string, string | null] => [
          Object.keys(people).find((k) => people[k] === p.userId) ?? p.userId,
          p.teamName,
        ]),
      );
    // Sales shares Team A with multi, although Alpha comes first by name.
    expect(await teams('sales', 'mine', 'transfer')).toEqual({
      multi: 'Team A',
      teammate: 'Team A',
    });
    // The manager shares no team: multi falls back to Alpha by name; the manager, in no team, is listed with null.
    expect(await teams('manager', 'theirs', 'assign')).toEqual({
      manager: null,
      multi: 'Alpha',
      sales: 'Team A',
      teammate: 'Team A',
    });
  });

  it('refuses as the action does: 403 for a role without it or a transfer of one not held, 404 unseen, 400 without purpose', async () => {
    expect((await list('sales', 'mine', 'assign')).status).toBe(403);
    expect((await list('sales', 'queued', 'transfer')).status).toBe(403);
    expect((await list('marketing', 'mine', 'transfer')).status).toBe(403);
    expect((await list('sales', 'theirs', 'transfer')).status).toBe(404);
    expect((await list('manager', 'otherOrg', 'assign')).status).toBe(404);
    expect((await list('manager', 'theirs', 'claim')).status).toBe(400);
    const none = await fetch(`${url}/v1/conversations/${c['theirs']}/assignees`, {
      headers: { cookie: cookies['manager'] ?? '' },
    });
    expect(none.status).toBe(400);
  });

  it('agrees with the actions: whoever is left out is refused (403 or 422), and one who is listed is accepted', async () => {
    for (const [who, conv, action] of [
      ['sales', 'mine', 'transfer'],
      ['manager', 'theirs', 'assign'],
    ] as const) {
      const listed = ids(await list(who, conv, action));
      for (const key of CAST.filter((k) => !listed.includes(people[k] as string)))
        expect([403, 422], `${action} to ${key}`).toContain(await act(who, conv, action, key));
      expect(await act(who, conv, action, 'teammate')).toBe(200);
    }
  });
});
