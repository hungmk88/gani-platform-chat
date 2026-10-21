import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';
import { RealtimeService, type AgentNamespace } from './realtime.service.js';

// The handshake of /agent and its rooms over a real socket (realtime spec §2–3, N1–N2): Better Auth, the 2FA rule and PostgreSQL as
// in production. Org A: a manager of W1, a sales of W2, a viewer of W1, an owner without a second factor, a member of A and B with
// no organisation chosen; org B: a manager. And a person with an account but no organisation at all.
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
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
const opened: Socket[] = [];
let app: NestExpressApplication | undefined;
let agent: AgentNamespace;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, hash: string, memberships: [org: string, role: string, ws: string][]) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  for (const [org, role, ws] of memberships) {
    await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), org, id, role]);
    await q(`INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`, [randomUUID(), org, ws, id]);
  }
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

/** A socket to `nsp`, with the cookie of `who` and the given Origin; resolves when it is connected or refused. */
async function connect(
  who: string | null,
  o: { origin?: string; nsp?: string } = {},
): Promise<{ socket: Socket; refused?: { code: string; traceId: string } }> {
  const headers: Record<string, string> = { origin: o.origin ?? ORIGIN };
  if (who) headers['cookie'] = cookies[who] ?? '';
  const socket = io(`${url}${o.nsp ?? '/agent'}`, {
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
    forceNew: true,
    // What a client sends here is ignored by the server: the tenant is its own decision.
    auth: { orgId: orgB, workspaceIds: [WB] },
  });
  opened.push(socket);
  return new Promise((resolve) => {
    socket.once('connect', () => resolve({ socket }));
    socket.once('connect_error', (error: Error & { data?: { code: string; traceId: string } }) =>
      resolve({ socket, ...(error.data ? { refused: error.data } : {}) }),
    );
  });
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
  await person('manager', hash, [[orgA, 'manager', W1]]);
  await person('sales', hash, [[orgA, 'sales', W2]]);
  await person('viewer', hash, [[orgA, 'viewer', W1]]);
  await person('owner', hash, [[orgA, 'owner', W1]]);
  await person('both', hash, [[orgA, 'sales', W1], [orgB, 'sales', WB]]);
  await person('stranger', hash, [[orgB, 'manager', WB]]);
  await person('nobody', hash, []);
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
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['sessions WHERE user_id', users], ['workspace_members WHERE org_id', orgs], ['workspaces WHERE org_id', orgs],
    ['org_members WHERE org_id', orgs], ['organizations WHERE id', orgs], ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('the handshake of /agent (N1)', () => {
  it.each([
    ['no session cookie', null, {}, 'unauthorized'],
    [
      'an Origin of another site',
      'manager',
      { origin: 'https://evil.example' },
      'forbidden_origin',
    ],
    // The proof that the 2FA gate of Express does not cover the socket, and the handshake does its check again (N94).
    ['an owner without a second factor', 'owner', {}, 'two_factor_setup_required'],
    ['a person of no organisation', 'nobody', {}, 'no_organisation'],
    ['a member of two organisations who chose none', 'both', {}, 'org_not_selected'],
    ['the main namespace', 'manager', { nsp: '/' }, 'unauthorized'],
  ] as const)('refuses %s with %s and a traceId', async (_name, who, o, code) => {
    const { socket, refused } = await connect(who, o);
    expect(socket.connected).toBe(false);
    expect(refused?.code).toBe(code);
    expect(refused?.traceId).toEqual(expect.any(String));
  });

  it('refuses a sixth socket of the same person on the instance', async () => {
    const five = await Promise.all(Array.from({ length: 5 }, () => connect('stranger')));
    expect(five.every((c) => c.socket.connected)).toBe(true);
    expect((await connect('stranger')).refused?.code).toBe('rate_limited');
    for (const c of five) c.socket.disconnect();
  });
});

describe('the rooms of /agent (N2)', () => {
  it('puts each socket in the rooms of its own context only: no packet crosses a workspace, a person or an organisation', async () => {
    const keys = ['manager', 'sales', 'viewer', 'stranger'] as const;
    const got: Record<string, string[]> = {};
    const sockets = await Promise.all(
      keys.map(async (key) => {
        const { socket } = await connect(key);
        expect(socket.connected).toBe(true);
        got[key] = [];
        socket.on('probe', (room: string) => got[key]?.push(room));
        return socket;
      }),
    );
    const rooms = [
      `ws:${W1}`,
      `ws:${W2}`,
      `ws:${WB}`,
      `org:${orgA}`,
      `org:${orgB}`,
      `user:${people['sales']}`,
    ];
    for (let n = 0; n < 20; n++) for (const room of rooms) agent.to(room).emit('probe', room);
    // A last packet to every socket: once it is in, everything sent before it is too (one connection keeps the order).
    const done = sockets.map((s) => new Promise((resolve) => s.once('done', resolve)));
    agent.emit('done');
    await Promise.all(done);
    const count = (key: string): Record<string, number> =>
      Object.fromEntries(
        rooms
          .map((r): [string, number] => [r, got[key]?.filter((x) => x === r).length ?? 0])
          .filter(([, n]) => n > 0),
      );
    expect(count('manager')).toEqual({ [`ws:${W1}`]: 20, [`org:${orgA}`]: 20 });
    expect(count('sales')).toEqual({
      [`ws:${W2}`]: 20,
      [`org:${orgA}`]: 20,
      [`user:${people['sales']}`]: 20,
    });
    // A viewer may not read conversations: no room of a workspace (N142).
    expect(count('viewer')).toEqual({ [`org:${orgA}`]: 20 });
    expect(count('stranger')).toEqual({ [`ws:${WB}`]: 20, [`org:${orgB}`]: 20 });
  });
});
