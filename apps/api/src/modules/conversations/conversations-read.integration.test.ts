import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// GET /v1/conversations, /{id}, /{id}/messages over HTTP with the real middleware, Better Auth and PostgreSQL (RLS as app_role).
// Org A: workspaces W1 (everyone below is a member) and W2 (nobody is); org B is a stranger. The roles are the ones Phụ lục B rows
// 11–12 tell apart: a manager sees all of W1, sales see their own and the unclaimed, marketing nothing.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
// prettier-ignore
const [orgA, orgB, W1, W2, WB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const c: Record<string, string> = {};
const customer = randomUUID();
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
async function conversation(key: string, org: string, ws: string, o: { assigned?: string; state?: string; hold?: boolean; at: string }) {
  c[key] = randomUUID();
  await q(
    `INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, after_hours_hold, last_message_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c[key], org, ws, o.state ?? (o.assigned ? 'HUMAN_ACTIVE' : 'BOT_ACTIVE'), o.assigned ?? null, o.hold ?? false, o.at],
  );
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
  // prettier-ignore
  return { status: res.status, type: res.headers.get('content-type'), body: (await res.json()) as Record<string, unknown> };
};
const ids = (body: Record<string, unknown>) => (body['data'] as { id: string }[]).map((x) => x.id);

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: 'http://localhost:3000', APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[W1, orgA], [W2, orgA], [WB, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  for (const [key, org, role, ws] of [['manager', orgA, 'manager', W1], ['sales', orgA, 'sales', W1], ['colleague', orgA, 'sales', W1], ['marketing', orgA, 'marketing', W1], ['stranger', orgB, 'manager', WB]] as const)
    await person(key, org, role, ws, hash);
  await conversation('mine', orgA, W1, { assigned: people['sales'] as string, at: '2026-10-05T00:00:00Z' });
  await conversation('theirs', orgA, W1, { assigned: people['colleague'] as string, at: '2026-10-04T00:00:00Z' });
  await conversation('queue', orgA, W1, { state: 'HUMAN_WAITING_Q', at: '2026-10-03T00:00:00Z' });
  await conversation('held', orgA, W1, { hold: true, at: '2026-10-02T00:00:00Z' });
  await conversation('otherWs', orgA, W2, { at: '2026-10-06T00:00:00Z' });
  await conversation('otherOrg', orgB, WB, { at: '2026-10-06T00:00:00Z' });
  // The customer of 'mine' (N165): the inbound worker names it; here the fixture does.
  await q(`INSERT INTO customers (id, org_id, display_name) VALUES ($1, $2, 'Chị Lan')`, [customer, orgA]);
  await q('UPDATE conversations SET customer_id = $1 WHERE id = $2', [customer, c['mine']]);
  for (let n = 1; n <= 3; n++)
    await q(`INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body) VALUES ($1, $2, $3, $4, $5, 'customer', 'text', 'm')`, [randomUUID(), orgA, W1, c['queue'], n]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  for (const key of ['manager', 'sales', 'marketing', 'stranger']) cookies[key] = await login(key);
});

// Children first (foreign keys). A failing step is swallowed: the CI database is thrown away after the job.
// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['messages WHERE org_id', orgs], ['conversations WHERE org_id', orgs], ['customers WHERE org_id', orgs], ['sessions WHERE user_id', users],
    ['workspace_members WHERE org_id', orgs], ['workspaces WHERE org_id', orgs], ['org_members WHERE org_id', orgs],
    ['organizations WHERE id', orgs], ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

// prettier-ignore
describe('GET /v1/conversations', () => {
  it('gives a manager every conversation of their workspaces, newest first, and nothing of another workspace or organisation', async () => {
    const res = await get('manager', '/v1/conversations');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([c['mine'], c['theirs'], c['queue'], c['held']]);
    expect(res.body['nextCursor']).toBeNull();
    expect((res.body['data'] as Record<string, unknown>[])[0]).toEqual({
      id: c['mine'], workspaceId: W1, state: 'HUMAN_ACTIVE', afterHoursHold: false, assignedUserId: people['sales'], version: 0,
      outcome: null, closedAt: null, lastMessageAt: '2026-10-05T00:00:00.000Z', lastCustomerMessageAt: null, channelAccountId: null,
      createdAt: expect.any(String) as string, customer: { id: customer, displayName: 'Chị Lan' },
    });
    expect((res.body['data'] as Record<string, unknown>[])[1]?.['customer']).toBeNull();
  });

  it('gives sales their own and the unclaimed ones only (Phụ lục B, N133)', async () => {
    expect(ids((await get('sales', '/v1/conversations')).body)).toEqual([c['mine'], c['queue'], c['held']]);
    expect(ids((await get('sales', '/v1/conversations?assignee=none')).body)).toEqual([c['queue'], c['held']]);
  });

  it('filters by assignee, state and hold, and pages with the cursor', async () => {
    expect(ids((await get('manager', '/v1/conversations?state=HUMAN_WAITING_Q')).body)).toEqual([c['queue']]);
    expect(ids((await get('manager', '/v1/conversations?hold=true')).body)).toEqual([c['held']]);
    expect(ids((await get('sales', '/v1/conversations?assignee=me')).body)).toEqual([c['mine']]);
    const first = await get('manager', '/v1/conversations?limit=3');
    const next = await get('manager', `/v1/conversations?limit=3&cursor=${String(first.body['nextCursor'])}`);
    expect([...ids(first.body), ...ids(next.body)]).toEqual([c['mine'], c['theirs'], c['queue'], c['held']]);
    expect(next.body['nextCursor']).toBeNull();
  });

  it('refuses marketing with 403 forbidden, and a bad query or cursor with 400 validation_failed', async () => {
    const refused = await get('marketing', '/v1/conversations');
    expect([refused.status, refused.type, refused.body['code']]).toEqual([403, 'application/problem+json', 'forbidden']);
    for (const query of ['limit=101', 'state=OPEN', 'assignee=everyone', 'workspaceId=x', 'cursor=bm90IG91cnM'])
      expect((await get('manager', `/v1/conversations?${query}`)).body, query).toMatchObject({ status: 400, code: 'validation_failed' });
  });
});

// prettier-ignore
describe('GET /v1/conversations/{id} and /messages', () => {
  it('answers 404 alike for what does not exist, another organisation, another workspace and what the role may not see', async () => {
    expect((await get('manager', `/v1/conversations/${c['queue']}`)).body).toMatchObject({ id: c['queue'], state: 'HUMAN_WAITING_Q', customer: null });
    expect((await get('sales', `/v1/conversations/${c['mine']}`)).body['customer']).toEqual({ id: customer, displayName: 'Chị Lan' });
    for (const [who, id] of [['manager', randomUUID()], ['manager', c['otherOrg']], ['manager', c['otherWs']], ['sales', c['theirs']], ['stranger', c['mine']]] as const) {
      const res = await get(who, `/v1/conversations/${String(id)}`);
      expect([res.status, res.body['code']], `${who} ${String(id)}`).toEqual([404, 'not_found']);
      expect(res.body['traceId']).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((await get('manager', '/v1/conversations/not-a-uuid')).body).toMatchObject({ status: 400, code: 'validation_failed' });
    expect((await get('marketing', `/v1/conversations/${c['queue']}`)).status).toBe(403);
  });

  it('pages the messages newest first, and hides those of a conversation the role may not see', async () => {
    const seq = (body: Record<string, unknown>) => (body['data'] as { sequenceNumber: number }[]).map((m) => m.sequenceNumber);
    const first = await get('sales', `/v1/conversations/${c['queue']}/messages?limit=2`);
    const next = await get('sales', `/v1/conversations/${c['queue']}/messages?limit=2&cursor=${String(first.body['nextCursor'])}`);
    expect([seq(first.body), seq(next.body), next.body['nextCursor']]).toEqual([[3, 2], [1], null]);
    expect((await get('sales', `/v1/conversations/${c['theirs']}/messages`)).status).toBe(404);
    expect((await get('stranger', `/v1/conversations/${c['queue']}/messages`)).status).toBe(404);
  });
});
