import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// The lock order of an answer to the customer (N107(4), (13)): POST /v1/conversations/{id}/messages takes the lock of the
// conversation before it reads its state, like every transition, over HTTP with PostgreSQL. Org A, W1 with a Zalo OA, one manager.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, W1, CA, MANAGER] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 3 });
const c: Record<string, string> = {};
let cookie = '';
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

type Answer = { status: number; body: Record<string, unknown> };
async function post(_who: string, path: string, body: unknown): Promise<Answer> {
  const res = await fetch(`${url}/v1/conversations/${path}`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', cookie, origin: ORIGIN, 'idempotency-key': randomUUID() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const send = (who: string, key: string) =>
  post(who, `${c[key]}/messages`, { text: 'Dạ em chào anh' });
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
  await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [orgA, `t-${orgA}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [W1, orgA, `w-${W1}`]);
  await q(`INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name) VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA')`, [CA, orgA, W1, `oa-${CA}`]);
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [MANAGER, `${MANAGER}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), MANAGER, MANAGER, await hashPassword(PW)]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'manager', 'active')`, [randomUUID(), orgA, MANAGER]);
  await q(`INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`, [randomUUID(), orgA, W1, MANAGER]);
  for (const key of ['race', 'ordered']) {
    const id = (c[key] = randomUUID());
    await q(`INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id, channel_account_id, external_user_id, last_customer_message_at)
             VALUES ($1, $2, $3, 'HUMAN_ACTIVE', $4, $5, $6, now() - interval '1 hour')`, [id, orgA, W1, MANAGER, CA, `zu-${id}`]);
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${MANAGER}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
}, 60_000);

// Children first (foreign keys). A failing step is swallowed: the CI database is thrown away after the job.
// prettier-ignore
afterAll(async () => {
  await app?.close();
  for (const [text, ids] of [
    ['message_deliveries WHERE org_id', [orgA]], ['outbox_events WHERE org_id', [orgA]], ['messages WHERE org_id', [orgA]],
    ['conversation_events WHERE org_id', [orgA]], ['conversations WHERE org_id', [orgA]], ['channel_accounts WHERE org_id', [orgA]],
    ['idempotency_keys WHERE org_id', [orgA]], ['sessions WHERE user_id', [MANAGER]], ['workspace_members WHERE org_id', [orgA]],
    ['workspaces WHERE org_id', [orgA]], ['org_members WHERE org_id', [orgA]], ['organizations WHERE id', [orgA]],
    ['accounts WHERE user_id', [MANAGER]], ['users WHERE id', [MANAGER]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('the lock order of POST /v1/conversations/{id}/messages', () => {
  // N107(13): the send takes the lock of the conversation before it writes, like every transition; a close racing ten answers
  // never deadlocks, and each answer either went in before the close or is refused after it.
  it('keeps the lock order with a close racing ten answers: no deadlock, nothing half written', async () => {
    const id = c['race'] as string;
    const { version } = await stateOf(id);
    const close = post('manager', `${id}/close`, { version, outcome: 'resolved' });
    const answers = await Promise.all(Array.from({ length: 10 }, () => send('manager', 'race')));
    const closed = await close;
    expect(closed.status).toBe(200);
    const statuses = answers.map((a) => a.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const sent = statuses.filter((s) => s === 201).length;
    expect(await counts(id)).toEqual({ messages: sent, deliveries: sent, outbox: sent });
    const numbers = answers.filter((a) => a.status === 201).map((a) => a.body['sequenceNumber']);
    expect(new Set(numbers).size).toBe(sent);
    expect((await stateOf(id)).state).toBe('CLOSED');
  });

  // The order itself, made certain: the test holds the lock, a close queues on it, then an answer. Released, the close goes first.
  // An answer that read the state before it waited for the lock would see HUMAN_ACTIVE and write into a closed conversation.
  it('takes the lock of the conversation before it reads the state (N107(4))', async () => {
    const id = c['ordered'] as string;
    const { version } = await stateOf(id);
    const holder = await admin.connect();
    // prettier-ignore
    const waiting = async () => ((await q(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = (hashtext($1::text)::bigint & 4294967295)::oid`,
      [id])).rows[0] as { n: number }).n;
    const until = async (n: number) => {
      for (let i = 0; i < 200 && (await waiting()) < n; i++)
        await new Promise((r) => setTimeout(r, 25));
      expect(await waiting()).toBe(n);
    };
    try {
      await holder.query('SELECT pg_advisory_lock(hashtext($1::text))', [id]);
      const close = post('manager', `${id}/close`, { version, outcome: 'resolved' });
      await until(1);
      const answer = send('manager', 'ordered');
      await until(2);
      await holder.query('SELECT pg_advisory_unlock(hashtext($1::text))', [id]);
      expect((await close).status).toBe(200);
      expect((await answer).body).toMatchObject({ status: 409, code: 'conversation_not_active' });
      expect(await counts(id)).toEqual({ messages: 0, deliveries: 0, outbox: 0 });
    } finally {
      await holder.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
      holder.release();
    }
  });
});
