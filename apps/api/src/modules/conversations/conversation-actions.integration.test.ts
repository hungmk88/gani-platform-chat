import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// POST /v1/conversations/{id}/claim and /wait-customer over HTTP with the real middleware, Better Auth, the Idempotency-Key
// interceptor and PostgreSQL (RLS as app_role). Org A, workspace W1: a manager, two sales, marketing and 50 agents for the race;
// a sales of W2 only; org B is a stranger.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W1, W2, WB] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const PW = randomBytes(18).toString('base64url');
const AGENTS = Array.from({ length: 50 }, (_, n) => `agent${n}`);
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const c: Record<string, string> = {};
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
// prettier-ignore
async function conversation(key: string, state: string, o: { assigned?: string; hold?: boolean; org?: string; ws?: string } = {}) {
  c[key] = randomUUID();
  await q(`INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, after_hours_hold) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c[key], o.org ?? orgA, o.ws ?? W1, state, o.assigned ?? null, o.hold ?? false]);
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
async function act(
  who: string,
  path: string,
  body?: object,
  key = randomUUID(),
  origin = ORIGIN,
): Promise<Answer> {
  const res = await fetch(`${url}/v1/conversations/${path}`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin, 'idempotency-key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const events = async (id: string) =>
  (await q('SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id = $1', [id]))
    .rows[0] as { n: number };

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[W1, orgA], [W2, orgA], [WB, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  for (const [key, org, role, ws] of [['manager', orgA, 'manager', W1], ['sales', orgA, 'sales', W1], ['colleague', orgA, 'sales', W1], ['marketing', orgA, 'marketing', W1], ['elsewhere', orgA, 'sales', W2], ['stranger', orgB, 'manager', WB]] as const)
    await person(key, org, role, ws, hash);
  for (const key of AGENTS) await person(key, orgA, key.endsWith('1') ? 'support' : 'sales', W1, hash);
  await conversation('race', 'HUMAN_WAITING_Q');
  await conversation('held', 'BOT_ACTIVE', { hold: true });
  await conversation('bot', 'BOT_ACTIVE');
  await conversation('mine', 'HUMAN_ACTIVE', { assigned: people['sales'] as string });
  await conversation('theirs', 'HUMAN_ACTIVE', { assigned: people['colleague'] as string });
  await conversation('otherOrg', 'HUMAN_WAITING_Q', { org: orgB, ws: WB });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const everyone = ['manager', 'sales', 'colleague', 'marketing', 'elsewhere', 'stranger', ...AGENTS];
  for (let n = 0; n < everyone.length; n += 10)
    await Promise.all(everyone.slice(n, n + 10).map(async (key) => (cookies[key] = await login(key))));
}, 120_000);

// Children first (foreign keys). A failing step is swallowed: the CI database is thrown away after the job.
// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['outbox_events WHERE org_id', orgs], ['conversation_events WHERE org_id', orgs], ['conversations WHERE org_id', orgs],
    ['idempotency_keys WHERE org_id', orgs], ['sessions WHERE user_id', users], ['workspace_members WHERE org_id', orgs],
    ['workspaces WHERE org_id', orgs], ['org_members WHERE org_id', orgs], ['organizations WHERE id', orgs],
    ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

// prettier-ignore
describe('POST /v1/conversations/{id}/claim', () => {
  it('lets exactly one of 50 agents who claim at once win; the 49 others learn who did (claim-race, PRR-05)', async () => {
    const answers = await Promise.all(AGENTS.map((key) => act(key, `${c['race']}/claim`)));
    const won = answers.filter((a) => a.status === 200);
    expect(won).toHaveLength(1);
    const winner = won[0]?.body['assignedUserId'];
    expect(won[0]?.body).toMatchObject({ id: c['race'], state: 'HUMAN_ACTIVE', version: 1 });
    expect(AGENTS.map((k) => people[k])).toContain(winner);
    const lost = answers.filter((a) => a.status !== 200);
    expect(lost).toHaveLength(49);
    for (const a of lost) expect([a.status, a.body['code'], a.body['assignedUserId']]).toEqual([409, 'conversation_already_claimed', winner]);
    expect(await events(c['race'] as string)).toEqual({ n: 1 });
  }, 60_000);

  it('claims a conversation held out of hours (T06), and gives the same answer to the same key without a second event', async () => {
    const key = randomUUID();
    const first = await act('sales', `${c['held']}/claim`, undefined, key);
    expect(first).toMatchObject({ status: 200, body: { state: 'HUMAN_ACTIVE', afterHoursHold: false, assignedUserId: people['sales'] } });
    expect(await act('sales', `${c['held']}/claim`, undefined, key)).toEqual(first);
    expect(await events(c['held'] as string)).toEqual({ n: 1 });
    expect((await act('colleague', `${c['held']}/claim`)).body).toMatchObject({ code: 'conversation_already_claimed', assignedUserId: people['sales'] });
  });

  it('refuses a claim by role (403), out of the workspaces or the organisation (404), from a state that has no claim (409)', async () => {
    expect((await act('marketing', `${c['bot']}/claim`)).body).toMatchObject({ status: 403, code: 'forbidden' });
    for (const [who, id] of [['elsewhere', c['bot']], ['manager', c['otherOrg']], ['stranger', c['bot']], ['manager', randomUUID()]])
      expect((await act(who as string, `${String(id)}/claim`)).body, `${who}`).toMatchObject({ status: 404, code: 'not_found' });
    expect((await act('manager', `${c['bot']}/claim`)).body).toMatchObject({ status: 409, code: 'invalid_transition' });
    expect((await act('manager', `${c['bot']}/claim`, undefined, randomUUID(), 'https://evil.example.test')).status).toBe(403);
    expect((await act('manager', 'not-a-uuid/claim')).body).toMatchObject({ status: 400, code: 'validation_failed' });
  });
});

// prettier-ignore
describe('POST /v1/conversations/{id}/wait-customer', () => {
  it('lets the holder wait for the customer with the version they saw, and refuses a stale version with 409', async () => {
    expect(await act('sales', `${c['mine']}/wait-customer`, { version: 0 })).toMatchObject({ status: 200, body: { state: 'PENDING_CUSTOMER', version: 1 } });
    expect((await act('sales', `${c['mine']}/wait-customer`, { version: 0 })).body).toMatchObject({ status: 409, code: 'version_conflict' });
    expect((await act('sales', `${c['mine']}/wait-customer`, { version: 1 })).body).toMatchObject({ status: 409, code: 'invalid_transition' });
    for (const body of [undefined, {}, { version: -1 }, { version: '0' }, { version: 0, extra: 1 }])
      expect((await act('sales', `${c['mine']}/wait-customer`, body)).body, JSON.stringify(body)).toMatchObject({ status: 400, code: 'validation_failed' });
  });

  it('hides what sales do not hold (404), and lets a manager act on anyone’s conversation', async () => {
    expect((await act('sales', `${c['theirs']}/wait-customer`, { version: 0 })).status).toBe(404);
    expect((await act('marketing', `${c['theirs']}/wait-customer`, { version: 0 })).status).toBe(403);
    // Sales see the unclaimed, but waiting for the customer is the holder's (Phụ lục B): 403, not the 409 of the state.
    expect((await act('sales', `${c['bot']}/wait-customer`, { version: 0 })).body).toMatchObject({ status: 403, code: 'forbidden' });
    expect(await act('manager', `${c['theirs']}/wait-customer`, { version: 0 })).toMatchObject({ status: 200, body: { state: 'PENDING_CUSTOMER', assignedUserId: people['colleague'] } });
  });
});
