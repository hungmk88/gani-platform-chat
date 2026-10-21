import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';
import { RealtimeService, type AgentNamespace } from './realtime.service.js';

// What a client of /agent asks, over a real socket (realtime spec §3, §5, §6; N3, N5, N9). Org A: W1 with a manager, two sales, a
// viewer, and two managers whose rights change during the test; W2. Conversations: `open` in W1 with 250 messages, `theirs` in W1
// assigned to the other sales, `elsewhere` in W2. The session is checked again every second (SOCKET_REVALIDATE_S=1).
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [org, W1, W2] = [randomUUID(), randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const c: Record<string, string> = {};
const cookies: Record<string, string> = {};
const opened: Socket[] = [];
let app: NestExpressApplication | undefined;
let agent: AgentNamespace;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, role: string, hash: string) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), org, id, role]);
  await q(`INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`, [randomUUID(), org, W1, id]);
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
async function connect(who: string): Promise<Socket> {
  const socket = io(`${url}/agent`, {
    transports: ['websocket'],
    extraHeaders: { origin: ORIGIN, cookie: cookies[who] ?? '' },
    reconnection: false,
    forceNew: true,
  });
  opened.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
type Answer = Record<string, unknown> & { ok: boolean; code?: string };
const ask = (socket: Socket, event: string, args: unknown) =>
  socket.timeout(10_000).emitWithAck(event, args) as Promise<Answer>;
const numbers = (answer: Answer) =>
  (answer['messages'] as { sequenceNumber: number }[]).map((m) => m.sequenceNumber);
async function until(probe: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!(await probe())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true', SOCKET_REVALIDATE_S: '1' });
  const hash = await hashPassword(PW);
  await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const ws of [W1, W2])
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  for (const [key, role] of [['manager', 'manager'], ['sales', 'sales'], ['colleague', 'sales'], ['viewer', 'viewer'], ['leaver', 'manager'], ['mover', 'manager']] as const)
    await person(key, role, hash);
  for (const [key, ws, assigned] of [['open', W1, null], ['theirs', W1, people['colleague']], ['elsewhere', W2, null]] as const) {
    c[key] = uuidv7();
    await q(`INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id) VALUES ($1, $2, $3, $4, $5)`, [c[key], org, ws, assigned ? 'HUMAN_ACTIVE' : 'BOT_ACTIVE', assigned ?? null]);
  }
  const ids = Array.from({ length: 250 }, () => uuidv7());
  await q(`INSERT INTO messages (id, org_id, workspace_id, conversation_id, sequence_number, sender_kind, kind, body)
           SELECT id, $2, $3, $4, n, 'customer', 'text', 'm' FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`, [ids, org, W1, c['open']]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  agent = nest.get(RealtimeService).agent as AgentNamespace;
  for (const key of Object.keys(people)) cookies[key] = await login(key);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  for (const socket of opened) socket.disconnect();
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['messages WHERE org_id', [org]], ['conversations WHERE org_id', [org]], ['sessions WHERE user_id', users],
    ['workspace_members WHERE org_id', [org]], ['workspaces WHERE org_id', [org]], ['org_members WHERE org_id', [org]],
    ['organizations WHERE id', [org]], ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('conversation.subscribe (N3)', () => {
  it('follows a conversation the person may see, and answers not_found alike for every one they may not', async () => {
    const [manager, sales, viewer] = [
      await connect('manager'),
      await connect('sales'),
      await connect('viewer'),
    ];
    expect(await ask(manager, 'conversation.subscribe', { conversationId: c['open'] })).toEqual({
      ok: true,
    });
    const notFound = { ok: false, code: 'not_found', traceId: expect.any(String) as string };
    expect(
      await ask(manager, 'conversation.subscribe', { conversationId: c['elsewhere'] }),
    ).toEqual(notFound);
    expect(await ask(manager, 'conversation.subscribe', { conversationId: uuidv7() })).toEqual(
      notFound,
    );
    expect(await ask(sales, 'conversation.subscribe', { conversationId: c['theirs'] })).toEqual(
      notFound,
    );
    expect(await ask(viewer, 'conversation.subscribe', { conversationId: c['open'] })).toEqual(
      notFound,
    );
    expect(await ask(manager, 'conversation.subscribe', { conversationId: 'x' })).toMatchObject({
      code: 'validation_failed',
    });
    // In the room: what is sent to it arrives; after unsubscribe it does not.
    const got: string[] = [];
    manager.on('probe', (n: string) => got.push(n));
    agent.to(`conv:${c['open']}`).emit('probe', 'one');
    await until(() => got.length === 1, 'the packet of the room');
    expect(await ask(manager, 'conversation.unsubscribe', { conversationId: c['open'] })).toEqual({
      ok: true,
    });
    agent.to(`conv:${c['open']}`).emit('probe', 'two');
    agent.to(`user:${people['manager']}`).emit('probe', 'sentinel');
    await until(() => got.includes('sentinel'), 'the sentinel');
    expect(got).toEqual(['one', 'sentinel']);
  });
});

describe('resume (N5)', () => {
  it('gives the messages after the last one the client has, page by page, and a resync when it is ahead', async () => {
    const manager = await connect('manager');
    const first = await ask(manager, 'resume', {
      conversationId: c['open'],
      lastSequenceNumber: 10,
    });
    expect(first).toMatchObject({
      ok: true,
      hasMore: true,
      resync: false,
      conversation: { id: c['open'], state: 'BOT_ACTIVE' },
    });
    expect(numbers(first)).toEqual(Array.from({ length: 200 }, (_, i) => i + 11));
    const second = await ask(manager, 'resume', {
      conversationId: c['open'],
      lastSequenceNumber: 210,
    });
    expect(second).toMatchObject({ ok: true, hasMore: false, resync: false });
    expect(numbers(second)).toEqual(Array.from({ length: 40 }, (_, i) => i + 211));
    expect(
      await ask(manager, 'resume', { conversationId: c['open'], lastSequenceNumber: 999 }),
    ).toMatchObject({ ok: true, messages: [], resync: true });
    expect(
      await ask(manager, 'resume', { conversationId: c['elsewhere'], lastSequenceNumber: 0 }),
    ).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('the session checked again (N9)', () => {
  it('ends the socket of a session that was revoked, within one period', async () => {
    const socket = await connect('leaver');
    const ended = new Promise<unknown>((resolve) => socket.once('session.ended', resolve));
    await q('DELETE FROM sessions WHERE user_id = $1', [people['leaver']]);
    expect(await ended).toMatchObject({ code: 'unauthorized' });
    await until(() => !socket.connected, 'the socket to be closed');
  });

  it('moves a socket to the room of the workspace its member now belongs to', async () => {
    const socket = await connect('mover');
    const got: string[] = [];
    socket.on('probe', (room: string) => got.push(room));
    await q('UPDATE workspace_members SET workspace_id = $1 WHERE user_id = $2', [
      W2,
      people['mover'],
    ]);
    await until(async () => {
      const [mine] = await agent.in(`user:${people['mover']}`).fetchSockets();
      return mine?.rooms.has(`ws:${W2}`) ?? false;
    }, 'the socket to be in the room of W2');
    for (const room of [`ws:${W1}`, `ws:${W2}`]) agent.to(room).emit('probe', room);
    agent.to(`user:${people['mover']}`).emit('probe', 'sentinel');
    await until(() => got.includes('sentinel'), 'the sentinel');
    expect(got).toEqual([`ws:${W2}`, 'sentinel']);
  });
});
