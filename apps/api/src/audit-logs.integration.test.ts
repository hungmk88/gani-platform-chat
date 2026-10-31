import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// GET /v1/audit-logs (Brief P9, A9a) over HTTP with the whole application and PostgreSQL. Org A: an owner and an admin (with a
// second factor) and a manager, three audit rows next month; org B: one audit row in between, which A never sees.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W] = [uuidv7(), uuidv7(), uuidv7()];
const [r1, r2, r3, rb] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
const HOUR = 3_600_000;
const T = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 10);
const at = (ms: number) => new Date(ms).toISOString();
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(role: string, hash: string) {
  const id = (people[role] = uuidv7());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`, [id, `${id}@example.test`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [uuidv7(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [uuidv7(), orgA, id, role]);
  await q('INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)', [uuidv7(), orgA, W, id]);
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${id}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  cookies[role] = res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  if (role === 'owner' || role === 'admin') await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [id]);
}
async function list(who: string, query = '') {
  const res = await fetch(`${url}/v1/audit-logs${query}`, {
    headers: { cookie: cookies[who] ?? '', origin: ORIGIN },
  });
  return {
    status: res.status,
    body: (await res.json()) as { data?: { id: string }[]; nextCursor?: string | null },
  };
}
const ids = async (who: string, query = '') => (await list(who, query)).body.data?.map((r) => r.id);

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, 'ww', 'W', 'service')`, [W, orgA]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ['owner', 'admin', 'manager']) await person(role, hash);
  const insert = `INSERT INTO audit_logs (id, org_id, actor_user_id, action, target_type, target_id, detail, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
  await q(insert, [r1, orgA, people['owner'], 'member.role_changed', 'member', W, { from: 'sales', to: 'manager' }, at(T - 3 * HOUR)]);
  await q(insert, [r2, orgA, people['admin'], 'member.two_factor_reset', 'member', W, { reason: 'Mất điện thoại' }, at(T - 2 * HOUR)]);
  await q(insert, [r3, orgA, null, 'workspace.updated', 'workspace', W, {}, at(T - HOUR)]);
  await q(insert, [rb, orgB, people['owner'], 'member.role_changed', 'member', W, {}, at(T - HOUR / 2)]);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, ids] of [
    ['audit_logs WHERE org_id', [orgA, orgB]], ['workspace_members WHERE org_id', [orgA]], ['workspaces WHERE org_id', [orgA]],
    ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA]], ['accounts WHERE user_id', users],
    ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET /v1/audit-logs', () => {
  it('gives an Owner or an Admin the log of their organisation, newest first, and nothing of another', async () => {
    const answer = await list('owner');
    expect(answer.status).toBe(200);
    expect(answer.body.data).toEqual([
      {
        id: r3,
        actorUserId: null,
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: W,
        detail: {},
        createdAt: at(T - HOUR),
      },
      {
        id: r2,
        actorUserId: people['admin'],
        action: 'member.two_factor_reset',
        targetType: 'member',
        targetId: W,
        detail: { reason: 'Mất điện thoại' },
        createdAt: at(T - 2 * HOUR),
      },
      {
        id: r1,
        actorUserId: people['owner'],
        action: 'member.role_changed',
        targetType: 'member',
        targetId: W,
        detail: { from: 'sales', to: 'manager' },
        createdAt: at(T - 3 * HOUR),
      },
    ]);
    expect(await ids('admin')).toEqual([r3, r2, r1]);
  });

  it('filters by person, action and time (from included, to left out), and stops at the limit', async () => {
    expect(await ids('owner', `?actorUserId=${people['owner']}`)).toEqual([r1]);
    expect(await ids('owner', '?action=member.two_factor_reset')).toEqual([r2]);
    expect(await ids('owner', `?from=${at(T - 2 * HOUR)}&to=${at(T - HOUR)}`)).toEqual([r2]);
    expect(await ids('owner', '?limit=1')).toEqual([r3]);
    expect(await ids('owner', '?targetType=workspace')).toEqual([r3]);
  });

  it('gives the next page from nextCursor, in the same filters (A9b)', async () => {
    const first = await list('owner', '?limit=2');
    expect([first.body.data?.map((r) => r.id), typeof first.body.nextCursor]).toEqual([
      [r3, r2],
      'string',
    ]);
    const next = await list('owner', `?limit=2&cursor=${first.body.nextCursor ?? ''}`);
    expect([next.body.data?.map((r) => r.id), next.body.nextCursor]).toEqual([[r1], null]);
  });

  it('refuses other roles, an organisation asked for, and bad filters', async () => {
    const answers = [
      await list('manager'),
      await list('owner', `?orgId=${orgB}`),
      await list('owner', `?from=${at(T)}&to=${at(T)}`),
      await list('owner', '?limit=101'),
      await list('owner', '?actorUserId=x'),
      await list('owner', '?action=DROP'),
      await list('owner', '?targetType=Member'),
      await list('owner', '?cursor=x'),
      await list('nobody'),
    ];
    expect(answers.map((a) => a.status)).toEqual([403, 400, 400, 400, 400, 400, 400, 400, 401]);
  });
});
