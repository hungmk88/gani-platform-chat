import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';
import { hashPassword } from '../auth/password.js';

// The three write paths of the leads (L5; N188, N196, T-3) over HTTP with the whole application and PostgreSQL, for the seven roles.
// Org A: one person of each role, all in workspace W, which has two steps and a reason to lose; W2 of A has none of them. Org B has a
// customer. The store's own rules (events, audit, NFC, mutants) are tested in packages/db; here, who may and the answer of each refusal.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const ROLES = ['owner', 'admin', 'manager', 'sales', 'marketing', 'viewer', 'support'] as const;
type Role = (typeof ROLES)[number];
const WRITERS: readonly Role[] = ['owner', 'admin', 'manager', 'sales'];
const [orgA, orgB, W, W2, WB, customerA, customerB, step1, step2] = Array.from({ length: 9 }, () =>
  uuidv7(),
);
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
async function send(
  who: Role,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  key?: string,
) {
  const res = await fetch(`${url}/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie: cookies[who],
      origin: ORIGIN,
      ...(path === '/leads' ? { 'idempotency-key': key ?? uuidv7() } : {}),
    },
    body: JSON.stringify(body),
  });
  const answer: Answer = {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
  return answer;
}
const make = (who: Role, body: Record<string, unknown> = {}, key?: string) =>
  send(
    who,
    'POST',
    '/leads',
    { workspaceId: W, customerId: customerA, title: 'Báo giá', ...body },
    key,
  );
const move = (who: Role, id: string, stageId = step2, version = 0) =>
  send(who, 'PATCH', `/leads/${id}/stage`, { version, stageId });
const close = (who: Role, id: string, body: Record<string, unknown> = { outcome: 'won' }) =>
  send(who, 'POST', `/leads/${id}/close`, { version: 0, ...body });
/** A lead made straight in the database at the first step, by `by`. */
async function lead(by: Role = 'manager') {
  const id = uuidv7();
  await q(
    `INSERT INTO leads (id, org_id, workspace_id, title, customer_id, stage_id, created_by) VALUES ($1, $2, $3, 'Báo giá', $4, $5, $6)`,
    [id, orgA, W, customerA, step1, people[by]],
  );
  return id;
}
const code = (a: Answer) => [a.status, a.body['code']];

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $4, 'ww', 'W', 'service'), ($2, $4, 'w2', 'W2', 'service'), ($3, $5, 'wb', 'WB', 'service')`, [W, W2, WB, orgA, orgB]);
  await q(`INSERT INTO customers (id, org_id, display_name) VALUES ($1, $3, 'Anh Ba'), ($2, $4, 'Khách B')`, [customerA, customerB, orgA, orgB]);
  await q(`INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $3, $4, 'Bước 1', 0), ($2, $3, $4, 'Bước 2', 1)`, [step1, step2, orgA, W]);
  await q(`INSERT INTO pipeline_lost_reasons (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'Giá cao', 0)`, [uuidv7(), orgA, W]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  const hash = await hashPassword(PW);
  for (const role of ROLES) await person(role, hash);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const users = Object.values(people);
  for (const [text, list] of [
    ['idempotency_keys WHERE org_id', [orgA, orgB]], ['audit_logs WHERE org_id', [orgA, orgB]],
    ['lead_events WHERE org_id', [orgA, orgB]], ['leads WHERE org_id', [orgA, orgB]],
    ['pipeline_lost_reasons WHERE org_id', [orgA, orgB]], ['pipeline_stages WHERE org_id', [orgA, orgB]],
    ['customers WHERE org_id', [orgA, orgB]], ['workspace_members WHERE org_id', [orgA, orgB]],
    ['workspaces WHERE org_id', [orgA, orgB]], ['sessions WHERE user_id', users], ['org_members WHERE org_id', [orgA, orgB]],
    ['accounts WHERE user_id', users], ['users WHERE id', users], ['organizations WHERE id', [orgA, orgB]],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [list]).catch(() => undefined);
  await admin.end();
});

describe('the write paths of the leads, role by role', () => {
  it('POST /v1/leads: Owner, Admin, Manager, Sales make a lead at the first step; Marketing, Viewer, Support 403', async () => {
    for (const role of ROLES) {
      const answer = await make(role);
      if (!WRITERS.includes(role)) expect(code(answer), role).toEqual([403, 'forbidden']);
      else
        expect(
          [answer.status, answer.body['status'], answer.body['stage'], answer.body['createdBy']],
          role,
        ).toEqual([201, 'open', { id: step1, name: 'Bước 1' }, people[role]]);
    }
    expect(code(await make('owner', { workspaceId: W2 }))).toEqual([404, 'not_found']);
    expect(code(await make('owner', { customerId: customerB }))).toEqual([404, 'not_found']);
    expect(code(await make('owner', { stageId: uuidv7() }))).toEqual([422, 'invalid_stage']);
    expect(code(await make('owner', { ownerUserId: people.support }))).toEqual([
      422,
      'invalid_assignee',
    ]);
    expect((await make('owner', { ownerUserId: people.sales })).body['owner']).toEqual({
      id: people.sales,
      name: 'Chị sales',
    });
  });

  it('POST /v1/leads with the same Idempotency-Key answers the first lead again, and another body 422 idempotency_key_reused', async () => {
    const key = uuidv7();
    const first = await make('manager', { title: 'Đơn sỉ' }, key);
    const again = await make('manager', { title: 'Đơn sỉ' }, key);
    expect([first.status, again.status, again.body['id']]).toEqual([201, 201, first.body['id']]);
    expect(code(await make('manager', { title: 'Đơn lẻ' }, key))).toEqual([
      422,
      'idempotency_key_reused',
    ]);
    const made = await q(
      `SELECT count(*)::int AS n FROM leads WHERE org_id = $1 AND title = 'Đơn sỉ'`,
      [orgA],
    );
    expect(made.rows[0]).toEqual({ n: 1 });
  });

  it('PATCH /v1/leads/{id}/stage: the writers move it; a Sales only their own (another is 404); the readers and Support 403', async () => {
    for (const role of ROLES) {
      const answer = await move(role, await lead());
      if (!WRITERS.includes(role)) expect(code(answer), role).toEqual([403, 'forbidden']);
      else if (role === 'sales') expect(code(answer), role).toEqual([404, 'not_found']);
      else expect([answer.status, answer.body['version']], role).toEqual([200, 1]);
    }
    expect((await move('sales', await lead('sales'))).status).toBe(200);
    const id = await lead();
    expect(code(await move('manager', id, step1))).toEqual([422, 'invalid_stage']);
    expect(code(await move('manager', id, step2, 3))).toEqual([409, 'version_conflict']);
    expect(code(await move('manager', uuidv7()))).toEqual([404, 'not_found']);
  });

  it('POST /v1/leads/{id}/close: the writers win or lose it for good; refusals answer their codes', async () => {
    for (const role of ROLES) {
      const answer = await close(role, await lead());
      if (!WRITERS.includes(role)) expect(code(answer), role).toEqual([403, 'forbidden']);
      else if (role === 'sales') expect(code(answer), role).toEqual([404, 'not_found']);
      else expect([answer.status, answer.body['status']], role).toEqual([200, 'won']);
    }
    const id = await lead('sales');
    expect(code(await close('sales', id, { outcome: 'lost', lostReason: 'Không có' }))).toEqual([
      422,
      'invalid_lost_reason',
    ]);
    expect(code(await close('sales', id, { outcome: 'lost' }))).toEqual([400, 'validation_failed']);
    const lost = await close('sales', id, { outcome: 'lost', lostReason: 'Giá cao' });
    expect([lost.status, lost.body['status'], lost.body['lostReason']]).toEqual([
      200,
      'lost',
      'Giá cao',
    ]);
    expect(code(await close('sales', id, { outcome: 'won', version: 1 }))).toEqual([
      409,
      'lead_closed',
    ]);
    expect(code(await move('sales', id, step2, 1))).toEqual([409, 'lead_closed']);
    // One audit row for the close, from the store; the API writes none of its own.
    const audit = await q(`SELECT action, detail FROM audit_logs WHERE target_id = $1`, [id]);
    expect(audit.rows).toEqual([{ action: 'lead.closed', detail: { outcome: 'lost' } }]);
  });
});
