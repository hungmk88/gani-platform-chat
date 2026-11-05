import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// The three read paths of the leads (L4; N188, N196, N201) over HTTP with the whole application and PostgreSQL, for the seven roles.
// Org A: one person of each role, all in workspace W, which has two steps and a reason to lose; W2 of A has none of them. Org B has a
// workspace and a lead. In W: a lead the Sales made, and one a Manager made and follows.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const ROLES = ['owner', 'admin', 'manager', 'sales', 'marketing', 'viewer', 'support'] as const;
type Role = (typeof ROLES)[number];
const [orgA, orgB, W, W2, WB, customerA, customerB, step1, step2, stepB] = Array.from(
  { length: 10 },
  () => uuidv7(),
);
const lead = { sales: uuidv7(), manager: uuidv7(), orgB: uuidv7() };
/** The member of org B who made its lead. */
const userB = uuidv7();
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people = {} as Record<Role, string>;
const cookies = {} as Record<Role, string>;
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);

// prettier-ignore
async function person(role: Role, hash: string) {
  const id = (people[role] = uuidv7());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), $3)`, [id, `${id}@example.test`, `Chị ${role}`]);
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
type Answer = { status: number; body: Record<string, unknown> };
async function get(who: Role, path: string): Promise<Answer> {
  const res = await fetch(`${url}/v1${path}`, {
    headers: { cookie: cookies[who], origin: ORIGIN },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const ids = (a: Answer) => (a.body['data'] as { id: string }[]).map((l) => l.id).sort();

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $4, 'ww', 'W', 'service'), ($2, $4, 'w2', 'W2', 'service'), ($3, $5, 'wb', 'WB', 'service')`, [W, W2, WB, orgA, orgB]);
  await q(`INSERT INTO customers (id, org_id, display_name) VALUES ($1, $3, 'Anh Ba'), ($2, $4, 'Khách B')`, [customerA, customerB, orgA, orgB]);
  await q(`INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $4, $5, 'Bước 1', 0), ($2, $4, $5, 'Bước 2', 1), ($3, $6, $7, 'Bước 1', 0)`, [step1, step2, stepB, orgA, W, orgB, WB]);
  await q(`INSERT INTO pipeline_lost_reasons (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'Giá cao', 0)`, [uuidv7(), orgA, W]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ROLES) await person(role, hash);
  const insert = `INSERT INTO leads (id, org_id, workspace_id, title, customer_id, stage_id, owner_user_id, created_by, created_at) VALUES ($1, $2, $3, 'Báo giá', $4, $5, $6, $7, $8)`;
  await q(insert, [lead.sales, orgA, W, customerA, step1, null, people.sales, '2026-11-05T08:00:00Z']);
  await q(insert, [lead.manager, orgA, W, customerA, step2, people.manager, people.manager, '2026-11-05T09:00:00Z']);
  await q(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active')`, [userB, `${userB}@example.test`]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'owner', 'active')`, [uuidv7(), orgB, userB]);
  await q(insert, [lead.orgB, orgB, WB, customerB, stepB, null, userB, '2026-11-05T09:00:00Z']);
  await q(`INSERT INTO lead_events (id, org_id, workspace_id, lead_id, type, to_stage_id, actor_user_id) VALUES ($1, $2, $3, $4, 'created', $5, $6)`, [uuidv7(), orgA, W, lead.manager, step1, people.manager]);
  await q(`INSERT INTO lead_events (id, org_id, workspace_id, lead_id, type, from_stage_id, to_stage_id, actor_user_id) VALUES ($1, $2, $3, $4, 'stage_changed', $5, $6, $7)`, [uuidv7(), orgA, W, lead.manager, step1, step2, people.manager]);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = [...Object.values(people), userB];
  for (const [text, list] of [
    ['lead_events WHERE org_id', [orgA, orgB]], ['leads WHERE org_id', [orgA, orgB]],
    ['pipeline_lost_reasons WHERE org_id', [orgA, orgB]], ['pipeline_stages WHERE org_id', [orgA, orgB]],
    ['customers WHERE org_id', [orgA, orgB]], ['workspace_members WHERE org_id', [orgA, orgB]],
    ['workspaces WHERE org_id', [orgA, orgB]], ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]],
    ['accounts WHERE user_id', users], ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [list]).catch(() => undefined);
  await admin.end();
});

describe('the read paths of the leads, role by role', () => {
  it('GET /v1/workspaces/{id}/pipeline: the steps and reasons for every role but Support (403); another workspace 404', async () => {
    for (const role of ROLES) {
      const answer = await get(role, `/workspaces/${W}/pipeline`);
      if (role === 'support') expect(answer.status, role).toBe(403);
      else
        expect([answer.status, answer.body], role).toEqual([
          200,
          {
            data: [
              { id: step1, name: 'Bước 1', position: 0 },
              { id: step2, name: 'Bước 2', position: 1 },
            ],
            lostReasons: ['Giá cao'],
          },
        ]);
    }
    for (const ws of [W2, WB])
      expect((await get('owner', `/workspaces/${ws}/pipeline`)).status).toBe(404);
  });

  it('GET /v1/leads: every lead of W for the readers, the Sales only theirs, Support 403; filters and another workspace', async () => {
    for (const role of ROLES) {
      const answer = await get(role, `/leads?workspaceId=${W}`);
      if (role === 'support') expect(answer.status, role).toBe(403);
      else if (role === 'sales')
        expect([answer.status, ids(answer)], role).toEqual([200, [lead.sales]]);
      else
        expect([answer.status, ids(answer)], role).toEqual([
          200,
          [lead.sales, lead.manager].sort(),
        ]);
    }
    expect(ids(await get('manager', '/leads?owner=me'))).toEqual([lead.manager]);
    expect(ids(await get('owner', '/leads?owner=none'))).toEqual([lead.sales]);
    expect(ids(await get('sales', '/leads?createdBy=me'))).toEqual([lead.sales]);
    const page = await get('owner', '/leads?limit=1');
    expect([ids(page), typeof page.body['nextCursor']]).toEqual([[lead.manager], 'string']);
    const next = await get(
      'owner',
      `/leads?limit=1&cursor=${encodeURIComponent(page.body['nextCursor'] as string)}`,
    );
    expect([ids(next), next.body['nextCursor']]).toEqual([[lead.sales], null]);
    expect((await get('owner', '/leads?cursor=nope')).status).toBe(400);
    expect((await get('owner', `/leads?workspaceId=${W2}`)).status).toBe(404);
  });

  it('GET /v1/leads/{id}: the lead with its events for whom may see it; a Sales’ other lead and another organisation’s 404', async () => {
    for (const role of ROLES) {
      const answer = await get(role, `/leads/${lead.manager}`);
      if (role === 'support') expect(answer.status, role).toBe(403);
      else if (role === 'sales') expect(answer.status, role).toBe(404);
      else expect(answer.status, role).toBe(200);
    }
    expect((await get('manager', `/leads/${lead.manager}`)).body).toEqual({
      id: lead.manager,
      workspaceId: W,
      title: 'Báo giá',
      customer: { id: customerA, displayName: 'Anh Ba' },
      conversationId: null,
      stage: { id: step2, name: 'Bước 2' },
      status: 'open',
      owner: { id: people.manager, name: 'Chị manager' },
      createdBy: people.manager,
      lostReason: null,
      closedAt: null,
      score: null,
      version: 0,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: expect.any(String) as string,
      events: [
        {
          type: 'created',
          fromStage: null,
          toStage: { id: step1, name: 'Bước 1' },
          outcome: null,
          actorUserId: people.manager,
          occurredAt: expect.any(String) as string,
        },
        {
          type: 'stage_changed',
          fromStage: { id: step1, name: 'Bước 1' },
          toStage: { id: step2, name: 'Bước 2' },
          outcome: null,
          actorUserId: people.manager,
          occurredAt: expect.any(String) as string,
        },
      ],
    });
    expect((await get('sales', `/leads/${lead.sales}`)).status).toBe(200);
    expect((await get('owner', `/leads/${lead.orgB}`)).status).toBe(404);
    expect((await get('owner', '/leads/not-a-uuid')).status).toBe(400);
  });

  it('cuts the events at 500 and logs lead_events_capped with ids only', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    await q(
      `INSERT INTO lead_events (id, org_id, workspace_id, lead_id, type, actor_user_id) SELECT unnest($4::uuid[]), $1, $2, $3, 'owner_changed', $5`,
      [orgA, W, lead.sales, Array.from({ length: 501 }, () => uuidv7()), people.manager],
    );
    const answer = await get('owner', `/leads/${lead.sales}`);
    expect((answer.body['events'] as unknown[]).length).toBe(500);
    const lines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.startsWith('lead_events_capped'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(`^lead_events_capped lead=${lead.sales} org=${orgA} trace=\\S+$`),
    );
    warn.mockRestore();
  });
});
