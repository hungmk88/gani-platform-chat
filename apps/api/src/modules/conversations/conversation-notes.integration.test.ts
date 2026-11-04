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

// /v1/conversations/{id}/notes (C6-3, N194) over HTTP with the whole application and PostgreSQL. Org A, workspace W1: a manager, a sales
// who holds 'mine', a colleague (sales) who holds 'theirs', a marketing; 'queue' is unclaimed, 'closed' is closed. W2 and org B hold one
// conversation each that nobody of W1 sees.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W1, W2, WB] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const c: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, role: string, hash: string) {
  const id = (people[key] = uuidv7());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), $3)`, [id, `${id}@example.test`, key]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [uuidv7(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [uuidv7(), orgA, id, role]);
  await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [uuidv7(), orgA, W1, id]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[key] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
}
// prettier-ignore
async function conversation(key: string, org: string, ws: string, extra = '', values: unknown[] = []) {
  c[key] = uuidv7();
  await q(`INSERT INTO conversations (id, org_id, workspace_id, state${extra ? `, ${extra}` : ''}) VALUES ($1, $2, $3, $4${values.slice(1).map((_, i) => `, $${i + 5}`).join('')})`, [c[key], org, ws, ...values]);
}
type Answer = { status: number; body: Record<string, unknown> };
async function call(
  who: string,
  method: string,
  id: string,
  body?: unknown,
  key: string = randomUUID(),
) {
  const res = await fetch(
    `${url}/v1/conversations/${id}/notes${method === 'GET' && typeof body === 'string' ? body : ''}`,
    {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: cookies[who] ?? '',
        origin: ORIGIN,
        ...(method === 'POST' && key ? { 'idempotency-key': key } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    },
  );
  const answer: Answer = {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
  return answer;
}
const write = (who: string, id: string, body: unknown, key?: string) =>
  call(who, 'POST', id, body, key);
const read = (who: string, id: string, query = '') => call(who, 'GET', id, query);
type Note = { id: string; kind: string; body: string; author: { id: string; name: string | null } };
const notes = (a: Answer) => a.body['data'] as Note[];

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[W1, orgA], [W2, orgA], [WB, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const [key, role] of [['manager', 'manager'], ['sales', 'sales'], ['colleague', 'sales'], ['marketing', 'marketing']] as const)
    await person(key, role, hash);
  await conversation('mine', orgA, W1, 'assigned_user_id', ['HUMAN_ACTIVE', people['sales']]);
  await conversation('theirs', orgA, W1, 'assigned_user_id', ['HUMAN_ACTIVE', people['colleague']]);
  await conversation('queue', orgA, W1, '', ['HUMAN_WAITING_Q']);
  await conversation('closed', orgA, W1, 'closed_at, outcome', ['CLOSED', new Date(), 'resolved']);
  await conversation('otherWs', orgA, W2, '', ['HUMAN_WAITING_Q']);
  await conversation('otherOrg', orgB, WB, '', ['HUMAN_WAITING_Q']);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['audit_logs WHERE org_id', [orgA, orgB]], ['conversation_notes WHERE org_id', [orgA, orgB]],
    ['conversations WHERE org_id', [orgA, orgB]], ['workspace_members WHERE org_id', [orgA, orgB]], ['workspaces WHERE org_id', [orgA, orgB]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('/v1/conversations/{id}/notes', () => {
  it('lets the holder write a note, trimmed, once per Idempotency-Key, audited by id only', async () => {
    const key = randomUUID();
    const made = await write('sales', c['mine']!, { body: '  Khách hẹn gọi lại 15h  ' }, key);
    expect(made).toMatchObject({
      status: 201,
      body: {
        conversationId: c['mine'],
        kind: 'note',
        body: 'Khách hẹn gọi lại 15h',
        author: { id: people['sales'], name: 'sales' },
      },
    });
    const again = await write('sales', c['mine']!, { body: '  Khách hẹn gọi lại 15h  ' }, key);
    expect([again.status, again.body['id']]).toEqual([201, made.body['id']]);
    const audit = await q(
      `SELECT detail, actor_user_id AS actor FROM audit_logs WHERE org_id = $1 AND action = 'conversation.note_added' AND target_id = $2`,
      [orgA, c['mine']],
    );
    expect(audit.rows).toEqual([
      { detail: { noteId: made.body['id'], kind: 'note' }, actor: people['sales'] },
    ]);
  });

  it('lets a manager write on any conversation of the workspace, in every state, the closed one too', async () => {
    for (const key of ['queue', 'theirs', 'closed'] as const)
      expect((await write('manager', c[key]!, { body: `Ghi chú ${key}` })).status, key).toBe(201);
  });

  it('refuses a writer who may not, and a body or a header that is not valid', async () => {
    expect((await write('sales', c['queue']!, { body: 'Chưa nhận' })).status).toBe(403);
    expect((await write('sales', c['theirs']!, { body: 'Của đồng nghiệp' })).status).toBe(404);
    expect((await write('marketing', c['queue']!, { body: 'x' })).status).toBe(403);
    for (const id of [c['otherWs']!, c['otherOrg']!, uuidv7()])
      expect((await write('manager', id, { body: 'x' })).status, id).toBe(404);
    for (const body of [
      { body: '   ' },
      { body: 'x'.repeat(2001) },
      { body: 'x', kind: 'transfer_reason' },
      {},
    ])
      expect(
        (await write('manager', c['queue']!, body)).status,
        JSON.stringify(body).slice(0, 40),
      ).toBe(400);
    expect((await write('manager', c['queue']!, { body: 'x' }, '')).status).toBe(400);
  });

  it('reads the notes newest first a page at a time, to whoever sees the conversation', async () => {
    const first = await read('manager', c['queue']!, '?limit=1');
    expect(notes(first).map((n) => n.body)).toEqual(['Ghi chú queue']);
    expect(first.body['nextCursor']).toBeNull();
    // Sales see the unclaimed conversation, so they read its notes; a colleague's stays 404, as the conversation does.
    expect(notes(await read('sales', c['queue']!)).map((n) => n.author.name)).toEqual(['manager']);
    expect(notes(await read('sales', c['mine']!)).map((n) => n.body)).toEqual([
      'Khách hẹn gọi lại 15h',
    ]);
    expect((await read('sales', c['theirs']!)).status).toBe(404);
    expect((await read('marketing', c['queue']!)).status).toBe(403);
    for (const id of [c['otherWs']!, c['otherOrg']!])
      expect((await read('manager', id)).status).toBe(404);
    expect((await read('manager', c['queue']!, '?cursor=bm90IG91cnM')).status).toBe(400);
    await write('manager', c['queue']!, { body: 'Thứ hai' });
    const page = await read('manager', c['queue']!, '?limit=1');
    const next = await read(
      'manager',
      c['queue']!,
      `?limit=1&cursor=${String(page.body['nextCursor'])}`,
    );
    expect([...notes(page), ...notes(next)].map((n) => n.body)).toEqual([
      'Thứ hai',
      'Ghi chú queue',
    ]);
  });
});
