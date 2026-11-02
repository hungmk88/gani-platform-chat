import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// /v1/tickets (K1c-1, U27, U52, N170) over HTTP with the whole application and PostgreSQL. Org A: an owner (with a second factor), a
// manager, a sales, a support and a marketing, all in workspace W, and a customer; W2 has none of them. Org B: a workspace, a customer.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W, W2, WB, customerA, customerB] = Array.from({ length: 7 }, () => randomUUID());
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
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), $3)`, [id, `${id}@example.test`, `Chị ${role}`]);
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
type Ticket = { id: string; title: string; assignee: { id: string; name: string | null } | null };
type Answer = { status: number; body: Record<string, unknown> };
async function call(who: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${url}/v1/tickets${path}`, {
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
const make = (who: string, body: Record<string, unknown>) =>
  call(who, 'POST', '', { workspaceId: W, ...body });
const titles = (a: Answer) => (a.body['data'] as Ticket[]).map((t) => t.title);

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $4, 'ww', 'W', 'service'), ($2, $4, 'w2', 'W2', 'service'), ($3, $5, 'wb', 'WB', 'service')`, [W, W2, WB, orgA, orgB]);
  await q(`INSERT INTO customers (id, org_id, display_name) VALUES ($1, $3, 'Anh Ba'), ($2, $4, 'Khách B')`, [customerA, customerB, orgA, orgB]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'manager', 'sales', 'support', 'marketing']) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['ticket_events WHERE org_id', [orgA, orgB]],
    ['tickets WHERE org_id', [orgA, orgB]], ['customers WHERE org_id', [orgA, orgB]],
    ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/tickets', () => {
  it('lets a Support make a ticket for a customer, given to a Manager, shown with their names', async () => {
    const made = await make('support', {
      title: '  Giao thiếu 2 thùng ',
      description: '',
      customerId: customerA,
      assigneeUserId: people['manager'],
    });
    expect(made.status).toBe(201);
    expect(made.body).toEqual({
      id: expect.any(String) as string,
      workspaceId: W,
      title: 'Giao thiếu 2 thùng',
      description: null,
      status: 'new',
      priority: 'normal',
      type: null,
      customer: { id: customerA, displayName: 'Anh Ba' },
      conversationId: null,
      assignee: { id: people['manager'], name: 'Chị manager' },
      sla: null,
      version: 0,
      createdBy: people['support'],
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    });
    const events = await q('SELECT type, to_status FROM ticket_events WHERE ticket_id = $1', [
      made.body['id'],
    ]);
    expect(events.rows).toEqual([{ type: 'created', to_status: 'new' }]);
  });

  it('reads newest first a page at a time, with the filters, and a Sales only the tickets they made', async () => {
    expect((await make('sales', { title: 'Của sales', priority: 'high' })).status).toBe(201);
    expect((await make('owner', { title: 'Của owner' })).status).toBe(201);
    const all = await call('manager', 'GET', `?workspaceId=${W}`);
    expect(all.status).toBe(200);
    expect(titles(all)).toEqual(['Của owner', 'Của sales', 'Giao thiếu 2 thùng']);
    expect(titles(await call('sales', 'GET', ''))).toEqual(['Của sales']);
    expect(titles(await call('sales', 'GET', `?assignee=${people['manager']}`))).toEqual([]);
    expect(titles(await call('manager', 'GET', '?assignee=me'))).toEqual(['Giao thiếu 2 thùng']);
    expect(titles(await call('support', 'GET', '?assignee=none&status=new'))).toEqual([
      'Của owner',
      'Của sales',
    ]);
    expect(titles(await call('support', 'GET', '?status=done'))).toEqual([]);
    const first = await call('support', 'GET', '?limit=2');
    expect(titles(first)).toEqual(['Của owner', 'Của sales']);
    const cursor = encodeURIComponent(first.body['nextCursor'] as string);
    const second = await call('support', 'GET', `?limit=2&cursor=${cursor}`);
    expect([titles(second), second.body['nextCursor']]).toEqual([['Giao thiếu 2 thùng'], null]);
  });

  it('shows an assignee who is no longer an active member with no name, and keeps the id', async () => {
    await q(`UPDATE org_members SET status = 'suspended' WHERE org_id = $1 AND user_id = $2`, [
      orgA,
      people['manager'],
    ]);
    const [ticket] = (await call('support', 'GET', `?assignee=${people['manager']}`)).body[
      'data'
    ] as Ticket[];
    await q(`UPDATE org_members SET status = 'active' WHERE org_id = $1 AND user_id = $2`, [
      orgA,
      people['manager'],
    ]);
    expect(ticket?.assignee).toEqual({ id: people['manager'], name: null });
  });

  it('refuses Marketing, workspaces and customers out of sight, an assignee who cannot handle tickets, and bad input', async () => {
    const answers = [
      await call('marketing', 'GET', ''),
      await make('marketing', { title: 'X' }),
      await call('owner', 'GET', `?workspaceId=${W2}`),
      await call('owner', 'GET', `?workspaceId=${WB}`),
      await make('owner', { workspaceId: W2, title: 'X' }),
      await make('owner', { title: 'X', customerId: customerB }),
      await make('owner', { title: 'X', assigneeUserId: people['sales'] }),
      await make('owner', { title: '   ' }),
      await make('owner', { title: 'X', status: 'done' }),
      await call('owner', 'GET', '?cursor=not-ours'),
      await call('owner', 'GET', '?assignee=someone'),
    ];
    expect(answers.map((a) => a.status)).toEqual([
      403, 403, 404, 404, 404, 404, 422, 400, 400, 400, 400,
    ]);
    expect(answers[6]?.body).toMatchObject({ code: 'invalid_assignee' });
    const written = await q('SELECT title FROM tickets WHERE org_id = $1 AND title = $2', [
      orgA,
      'X',
    ]);
    expect(written.rows).toEqual([]);
  });
});
