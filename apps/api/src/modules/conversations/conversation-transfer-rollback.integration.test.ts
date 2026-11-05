import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// The reason of a transfer and the transfer are one transaction (C6-4, N135, N194): here the note is written, then the step fails, as a
// crash between the two would. Nothing of the transfer may remain: not the holder, not the version, not its event, not its audit rows,
// not the note. Only this file replaces addConversationNote, so the other tests see the real one.
vi.mock('@gani/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@gani/db')>();
  return {
    ...real,
    addConversationNote: async (...args: Parameters<typeof real.addConversationNote>) => {
      await real.addConversationNote(...args);
      throw new Error('fault after the note was written');
    },
  };
});

const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [org, W, conversation] = [uuidv7(), uuidv7(), uuidv7()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
let cookie = '';
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);
const count = async (table: string, column: string) =>
  (
    (await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [conversation]))
      .rows[0] as { n: number }
  ).n;

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [W, org, `w-${W}`]);
  const hash = await hashPassword(PW);
  for (const [key, role] of [['manager', 'manager'], ['sales', 'sales'], ['colleague', 'sales']] as const) {
    const id = (people[key] = uuidv7());
    await q(`INSERT INTO users (id, email, status, email_verified_at) VALUES ($1, $2, 'active', now())`, [id, `${id}@example.test`]);
    await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [uuidv7(), id, id, hash]);
    await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [uuidv7(), org, id, role]);
    await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [uuidv7(), org, W, id]);
  }
  await q(`INSERT INTO conversations (id, org_id, workspace_id, state, assigned_user_id) VALUES ($1, $2, $3, 'HUMAN_ACTIVE', $4)`, [conversation, org, W, people['sales']]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${people['manager']}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['outbox_events WHERE org_id', [org]], ['conversation_events WHERE org_id', [org]], ['conversation_notes WHERE org_id', [org]],
    ['conversations WHERE org_id', [org]], ['idempotency_keys WHERE org_id', [org]], ['audit_logs WHERE org_id', [org]],
    ['sessions WHERE user_id', users], ['workspace_members WHERE org_id', [org]], ['workspaces WHERE org_id', [org]],
    ['org_members WHERE org_id', [org]], ['accounts WHERE user_id', users], ['users WHERE id', users], ['organizations WHERE id', [org]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('POST /v1/conversations/{id}/transfer with a reason', () => {
  it('leaves nothing of the transfer when writing its reason fails: one transaction (N135)', async () => {
    const res = await fetch(`${url}/v1/conversations/${conversation}/transfer`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: ORIGIN,
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify({
        version: 0,
        toUserId: people['colleague'],
        reason: 'Khách cần báo giá sỉ',
      }),
    });
    expect(res.status).toBe(500);
    const { rows } = await q(
      'SELECT assigned_user_id AS holder, version FROM conversations WHERE id = $1',
      [conversation],
    );
    const row = rows[0] as { holder: string; version: number };
    expect(row).toEqual({ holder: people['sales'], version: 0 });
    expect(await count('conversation_notes', 'conversation_id')).toBe(0);
    expect(await count('conversation_events', 'conversation_id')).toBe(0);
    expect(await count('audit_logs', 'target_id')).toBe(0);
    expect(await count('outbox_events', 'aggregate_id')).toBe(0);
  });
});
