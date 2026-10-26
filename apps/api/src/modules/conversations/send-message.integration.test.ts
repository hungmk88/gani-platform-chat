import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// POST /v1/conversations/{id}/messages (N146, channel-policy-spec §3) over HTTP with the real middleware, Better Auth, the
// Idempotency-Key interceptor and PostgreSQL. Org A, W1 with a Zalo OA: a manager, two sales, a marketing; org B is a stranger.
// The seeded Zalo policy is the one in force: 48 hours from the last message of the customer, 8 free messages.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W1, WB, CA] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const PW = randomBytes(18).toString('base64url');
const HOUR = 3_600_000;
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
interface Conv {
  state: string;
  assigned?: string;
  lastCustomerHoursAgo?: number | null;
  channel?: boolean;
  org?: string;
  ws?: string;
}
// prettier-ignore
async function conversation(key: string, o: Conv) {
  const id = (c[key] = randomUUID());
  const channel = o.channel ?? true;
  const last = o.lastCustomerHoursAgo === null ? null : new Date(Date.now() - (o.lastCustomerHoursAgo ?? 1) * HOUR);
  const closed = o.state === 'CLOSED';
  await q(`INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, channel_account_id, external_user_id, last_customer_message_at, closed_at, outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::boolean THEN now() END, CASE WHEN $9::boolean THEN 'resolved' END)`,
    [id, o.org ?? orgA, o.ws ?? W1, o.state, o.assigned ?? null, channel ? CA : null, channel ? `zu-${id}` : null, last, closed]);
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
async function post(
  who: string,
  path: string,
  body: unknown,
  key: string = randomUUID(),
): Promise<Answer> {
  const res = await fetch(`${url}/v1/conversations/${path}`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN, 'idempotency-key': key },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const send = (who: string, key: string, text: unknown = 'Dạ em chào anh', idem?: string) =>
  post(who, `${c[key] ?? key}/messages`, { text }, idem);
// prettier-ignore
const counts = async (id: string) => (await q(
  `SELECT (SELECT count(*)::int FROM messages WHERE conversation_id = $1) AS messages,
          (SELECT count(*)::int FROM message_deliveries WHERE conversation_id = $1) AS deliveries,
          (SELECT count(*)::int FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'message.created') AS outbox`, [id])).rows[0] as Record<string, number>;
const stateOf = async (id: string) =>
  (await q('SELECT state, version FROM conversations WHERE id = $1', [id])).rows[0] as {
    state: string;
    version: number;
  };

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[W1, orgA], [WB, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  await q(`INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name) VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA')`, [CA, orgA, W1, `oa-${CA}`]);
  for (const [key, org, role, ws] of [['manager', orgA, 'manager', W1], ['sales', orgA, 'sales', W1], ['colleague', orgA, 'sales', W1], ['marketing', orgA, 'marketing', W1], ['stranger', orgB, 'manager', WB]] as const)
    await person(key, org, role, ws, hash);
  const sales = people['sales'] as string;
  await conversation('mine', { state: 'HUMAN_ACTIVE', assigned: sales });
  await conversation('waiting', { state: 'PENDING_CUSTOMER', assigned: sales });
  await conversation('theirs', { state: 'HUMAN_ACTIVE', assigned: people['colleague'] as string });
  await conversation('queue', { state: 'HUMAN_WAITING_Q' });
  await conversation('bot', { state: 'BOT_ACTIVE' });
  await conversation('closed', { state: 'CLOSED' });
  await conversation('expired', { state: 'HUMAN_ACTIVE', assigned: sales, lastCustomerHoursAgo: 48.1 });
  await conversation('quota', { state: 'HUMAN_ACTIVE', assigned: sales });
  await conversation('noChannel', { state: 'HUMAN_ACTIVE', assigned: sales, channel: false, lastCustomerHoursAgo: null });
  await conversation('again', { state: 'HUMAN_ACTIVE', assigned: sales });
  await conversation('otherOrg', { state: 'HUMAN_ACTIVE', assigned: people['stranger'] as string, org: orgB, ws: WB, channel: false });
  // The free messages of `quota` are used up: the customer, then eight messages of the account.
  await q(`INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, sender_user_id, kind, body)
           SELECT gen_random_uuid(), $1, $2, $3, n, CASE WHEN n = 1 THEN 'customer' ELSE 'agent' END, CASE WHEN n = 1 THEN NULL ELSE $4::uuid END, 'text', 'm'
           FROM generate_series(1, 9) AS n`, [orgA, W1, c['quota'], sales]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  for (const key of Object.keys(people)) cookies[key] = await login(key);
}, 60_000);

// Children first (foreign keys). A failing step is swallowed: the CI database is thrown away after the job.
// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['message_deliveries WHERE org_id', orgs], ['outbox_events WHERE org_id', orgs], ['messages WHERE org_id', orgs],
    ['conversation_events WHERE org_id', orgs], ['conversations WHERE org_id', orgs], ['channel_accounts WHERE org_id', orgs],
    ['idempotency_keys WHERE org_id', orgs], ['sessions WHERE user_id', users], ['workspace_members WHERE org_id', orgs],
    ['workspaces WHERE org_id', orgs], ['org_members WHERE org_id', orgs], ['organizations WHERE id', orgs],
    ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('POST /v1/conversations/{id}/messages', () => {
  it('stores the answer of the holder with its pending delivery and its event, and leaves the state as it was', async () => {
    const res = await send('sales', 'mine', '  Dạ em chào anh  ');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sequenceNumber: 1,
      senderKind: 'agent',
      senderUserId: people['sales'],
      kind: 'text',
      body: 'Dạ em chào anh',
      deliveryStatus: 'pending',
    });
    const id = c['mine'] as string;
    expect(await counts(id)).toEqual({ messages: 1, deliveries: 1, outbox: 1 });
    const { rows } = await q(
      'SELECT status, channel_account_id, message_id FROM message_deliveries WHERE conversation_id = $1',
      [id],
    );
    expect(rows).toEqual([
      { status: 'pending', channel_account_id: CA, message_id: res.body['id'] },
    ]);
    expect((await stateOf(id)).state).toBe('HUMAN_ACTIVE');
    const list = await fetch(`${url}/v1/conversations/${id}/messages`, {
      headers: { cookie: cookies['sales'] ?? '' },
    });
    expect(((await list.json()) as { data: unknown[] }).data).toEqual([res.body]);
  });

  it('answers while waiting for the customer too, and a manager answers what a colleague holds', async () => {
    expect((await send('sales', 'waiting')).status).toBe(201);
    expect((await stateOf(c['waiting'] as string)).state).toBe('PENDING_CUSTOMER');
    expect((await send('manager', 'theirs')).status).toBe(201);
  });

  it('refuses a role that may not answer (403), and what the person may not see like what does not exist (404)', async () => {
    expect((await send('marketing', 'mine')).status).toBe(403);
    expect((await send('sales', 'theirs')).body).toMatchObject({ status: 404, code: 'not_found' });
    expect((await send('stranger', 'mine')).status).toBe(404);
    expect((await send('sales', 'otherOrg')).status).toBe(404);
    expect((await send('manager', randomUUID())).status).toBe(404);
  });

  it('refuses a conversation nobody holds, or closed, with 409 conversation_not_active', async () => {
    for (const key of ['queue', 'bot', 'closed'])
      expect((await send('manager', key)).body, key).toMatchObject({
        status: 409,
        code: 'conversation_not_active',
      });
  });

  it('C-N4: refuses outside the window, past the free messages and without a channel, writing nothing', async () => {
    const refused = (windowState: string, reason: string) => ({
      status: 422,
      code: 'channel_window_closed',
      windowState,
      reason,
    });
    expect((await send('sales', 'expired')).body).toMatchObject(
      refused('paid_only', 'window_expired'),
    );
    expect((await send('sales', 'quota')).body).toMatchObject(
      refused('paid_only', 'quota_exhausted'),
    );
    expect((await send('sales', 'noChannel')).body).toMatchObject(
      refused('api_closed', 'no_policy'),
    );
    expect(await counts(c['expired'] as string)).toEqual({ messages: 0, deliveries: 0, outbox: 0 });
    expect(await counts(c['quota'] as string)).toEqual({ messages: 9, deliveries: 0, outbox: 0 });
    expect(await counts(c['noChannel'] as string)).toEqual({
      messages: 0,
      deliveries: 0,
      outbox: 0,
    });
  });

  it('refuses an empty or too long text and any other field (400), and sends one message for one Idempotency-Key', async () => {
    for (const body of [
      { text: '   ' },
      { text: 'x'.repeat(2001) },
      { text: 'a', orgId: orgB },
      {},
    ])
      expect((await post('sales', `${c['again']}/messages`, body)).status).toBe(400);
    const key = randomUUID();
    const first = await send('sales', 'again', 'một lần', key);
    const second = await send('sales', 'again', 'một lần', key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    expect(await counts(c['again'] as string)).toEqual({ messages: 1, deliveries: 1, outbox: 1 });
  });

  it('refuses a text that still holds a {{variable}} of a quick reply (422 unresolved_variable), writing nothing', async () => {
    const id = c['mine'] as string;
    const before = await counts(id);
    for (const text of ['Chào {{customer_name}}', 'Gọi {{ company_phone }} nhé', '{{}}'])
      expect((await send('sales', 'mine', text)).body, text).toMatchObject({
        status: 422,
        code: 'unresolved_variable',
      });
    expect(await counts(id)).toEqual(before);
    expect((await send('sales', 'mine', 'Dạ {anh} cần gì ạ')).status).toBe(201);
  });
});
