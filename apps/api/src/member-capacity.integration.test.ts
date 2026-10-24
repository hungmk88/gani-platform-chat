import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// PATCH /v1/members/{id}/capacity (C9, N156) over HTTP with the whole application and PostgreSQL. Org A: an owner, an admin (with a
// second factor), a manager, a sales agent; org B: a member of its own.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB] = [randomUUID(), randomUUID()];
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const members: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(key: string, org: string, role: string, hash: string) {
  const id = (people[key] = randomUUID());
  members[key] = randomUUID();
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [members[key], org, id, role]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[key] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
async function setCapacity(who: string, id: string, body: unknown) {
  const res = await fetch(`${url}/v1/members/${id}/capacity`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '', origin: ORIGIN },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const audits = async (id: string) =>
  (
    await q(
      'SELECT actor_user_id, detail FROM audit_logs WHERE target_id = $1 AND action = $2 ORDER BY id',
      [id, 'member.capacity_changed'],
    )
  ).rows as unknown[];

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager', 'sales']) await person(role, orgA, role, hash);
  await person('stranger', orgB, 'sales', hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['audit_logs WHERE org_id', [orgA, orgB]], ['agent_settings WHERE org_id', [orgA, orgB]], ['sessions WHERE user_id', users],
    ['org_members WHERE org_id', [orgA, orgB]], ['accounts WHERE user_id', users], ['users WHERE id', users],
    ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('PATCH /v1/members/{id}/capacity', () => {
  it("sets a member's own limit, audited with both values; the same value again changes nothing", async () => {
    const id = members['sales'] as string;
    const list = async () =>
      (
        (await (
          await fetch(`${url}/v1/members`, { headers: { cookie: cookies['owner'] ?? '' } })
        ).json()) as {
          data: { id: string; maxConcurrentConversations: number | null }[];
        }
      ).data.find((m) => m.id === id)?.maxConcurrentConversations;
    expect(await list()).toBeNull();
    expect(await setCapacity('owner', id, { maxConcurrentConversations: 8 })).toMatchObject({
      status: 200,
      body: { id, maxConcurrentConversations: 8 },
    });
    expect((await setCapacity('admin', id, { maxConcurrentConversations: 3 })).status).toBe(200);
    expect((await setCapacity('admin', id, { maxConcurrentConversations: 3 })).status).toBe(200);
    expect(await list()).toBe(3);
    expect(await audits(id)).toEqual([
      { actor_user_id: people['owner'], detail: { from: null, to: 8 } },
      { actor_user_id: people['admin'], detail: { from: 8, to: 3 } },
    ]);
    // An Admin sets their own too, and an Owner's.
    expect(
      (await setCapacity('admin', members['admin'] as string, { maxConcurrentConversations: 2 }))
        .status,
    ).toBe(200);
    expect(
      (await setCapacity('admin', members['owner'] as string, { maxConcurrentConversations: 2 }))
        .status,
    ).toBe(200);
  });

  it('refuses other roles, members of another org, invitations, strangers and a limit out of 1..100', async () => {
    const pending = randomUUID();
    // prettier-ignore
    await q(`INSERT INTO org_members (id, org_id, role, status, invited_email, invite_token_hash, invite_expires_at)
      VALUES ($1, $2, 'sales', 'pending', $3, $4, now() + interval '1 day')`, [pending, orgA, `${pending}@example.test`, randomBytes(32)]);
    const ok = { maxConcurrentConversations: 4 };
    const answers = [
      await setCapacity('manager', members['sales'] as string, ok),
      await setCapacity('sales', members['sales'] as string, ok),
      await setCapacity('owner', members['stranger'] as string, ok),
      await setCapacity('owner', pending, ok),
      await setCapacity('owner', randomUUID(), ok),
      await setCapacity('owner', members['manager'] as string, { maxConcurrentConversations: 0 }),
      await setCapacity('owner', members['manager'] as string, { maxConcurrentConversations: 101 }),
      await setCapacity('owner', members['manager'] as string, { maxConcurrentConversations: 2.5 }),
      await setCapacity('owner', members['manager'] as string, {}),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 403, 404, 404, 404, 400, 400, 400, 400]);
    const rows = await q(
      'SELECT count(*)::int AS n FROM agent_settings WHERE user_id = ANY($1::uuid[])',
      [[people['manager'], people['stranger']]],
    );
    expect(rows.rows[0]).toEqual({ n: 0 });
  });
});
