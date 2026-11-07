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

// POST /v1/customers/merge, POST /{id}/unmerge, GET /{id}/merges over HTTP with the real middleware, Better Auth and PostgreSQL (RLS
// as app_role), J3c. Every person of org A is a member of WA only; each customer has a ticket and a lead in WB, so a merge that did
// not reach every live workspace (N204) would leave them behind. Org B has one customer nobody of org A sees.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [orgA, orgB, WA, WB, WX] = [
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
  randomUUID(),
];
const [STAGE, THEIRS] = [randomUUID(), randomUUID()];
const ROLES = ['owner', 'admin', 'manager', 'sales', 'support', 'marketing', 'viewer'] as const;
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, string> = {};
const cookies: Record<string, string> = {};
let app: NestExpressApplication | undefined;
let url = '';
const q = async <T = Record<string, unknown>>(text: string, params: unknown[]) =>
  (await admin.query(text, params)).rows as T[];
const ownerOf = async (table: 'tickets' | 'leads', id: string) =>
  (await q<{ customer_id: string }>(`SELECT customer_id FROM ${table} WHERE id = $1`, [id]))[0]!
    .customer_id;

// prettier-ignore
async function person(key: string, org: string, role: string, ws: string, hash: string) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), $3)`, [id, `${id}@example.test`, `Người ${key}`]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`, [randomUUID(), org, id, role]);
  await q(`INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`, [randomUUID(), org, ws, id]);
}
async function login(key: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    // prettier-ignore
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': [...randomBytes(4)].join('.') },
    body: JSON.stringify({ email: `${people[key]}@example.test`, password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((x) => x.split(';')[0])
    .join('; ');
}
interface Answer {
  status: number;
  body: Record<string, unknown>;
}
const call = async (
  key: string,
  method: string,
  path: string,
  body?: unknown,
  idem = uuidv7(),
): Promise<Answer> => {
  const res = await fetch(`${url}${path}`, {
    method,
    // A /v1 write with a cookie needs the Origin of the app (N136).
    headers: {
      cookie: cookies[key] ?? '',
      ...(method === 'POST'
        ? {
            origin: 'http://localhost:3000',
            'content-type': 'application/json',
            'idempotency-key': idem,
          }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const merge = (key: string, sourceId: string, targetId: string, idem?: string) =>
  call(key, 'POST', '/v1/customers/merge', { sourceId, targetId }, idem);
const unmerge = (key: string, id: string, idem?: string) =>
  call(key, 'POST', `/v1/customers/${id}/unmerge`, undefined, idem);
const merges = (key: string, id: string) => call(key, 'GET', `/v1/customers/${id}/merges`);
const logOf = (source: string) =>
  q<{ live: boolean }>(
    'SELECT unmerged_at IS NULL AS live FROM customer_merges WHERE source_id = $1 ORDER BY merged_at',
    [source],
  );

/** A customer of org A with a ticket and a lead in WB, where no person of org A is a member. */
async function customer(name: string | null = null) {
  const [id, ticket, lead] = [uuidv7(), uuidv7(), uuidv7()];
  await q('INSERT INTO customers (id, org_id, display_name) VALUES ($1, $2, $3)', [id, orgA, name]);
  await q(
    `INSERT INTO tickets (id, org_id, workspace_id, title, customer_id, created_by) VALUES ($1, $2, $3, 'T', $4, $5)`,
    [ticket, orgA, WB, id, people['owner']],
  );
  await q(
    `INSERT INTO leads (id, org_id, workspace_id, title, customer_id, stage_id, created_by) VALUES ($1, $2, $3, 'L', $4, $5, $6)`,
    [lead, orgA, WB, id, STAGE, people['owner']],
  );
  return { id, ticket, lead };
}

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: 'http://localhost:3000', APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const org of [orgA, orgB]) await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  for (const [ws, org] of [[WA, orgA], [WB, orgA], [WX, orgB]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  await q(`INSERT INTO pipeline_stages (id, org_id, workspace_id, name, position) VALUES ($1, $2, $3, 'B', 0)`, [STAGE, orgA, WB]);
  for (const role of ROLES) await person(role, orgA, role, WA, hash);
  await person('stranger', orgB, 'owner', WX, hash);
  await q('INSERT INTO customers (id, org_id, display_name) VALUES ($1, $2, $3)', [THEIRS, orgB, 'Của B']);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  for (const key of [...ROLES, 'stranger']) cookies[key] = await login(key);
  // An Owner or an Admin without 2FA set up is stopped by the gate (N93), as in audit-logs.integration.test.ts.
  await q('UPDATE users SET two_factor_enabled = true WHERE id = ANY($1::uuid[])', [[people['owner'], people['admin'], people['stranger']]]);
});

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['customer_merge_moves WHERE org_id', orgs], ['customer_merges WHERE org_id', orgs], ['leads WHERE org_id', orgs],
    ['tickets WHERE org_id', orgs], ['pipeline_stages WHERE org_id', orgs], ['idempotency_keys WHERE org_id', orgs],
    ['audit_logs WHERE org_id', orgs], ['customers WHERE org_id', orgs], ['sessions WHERE user_id', users],
    ['workspace_members WHERE org_id', orgs], ['workspaces WHERE org_id', orgs], ['org_members WHERE org_id', orgs],
    ['organizations WHERE id', orgs], ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('who may merge, unmerge and list (N204, N206)', () => {
  // Merging: Owner, Admin, Manager. Unmerging and the list: Owner, Admin only, not Manager.
  it.each(ROLES)('%s', async (role) => {
    const [s, t] = [await customer(), await customer()];
    const mayMerge = ['owner', 'admin', 'manager'].includes(role);
    const mayUnmerge = ['owner', 'admin'].includes(role);
    expect((await merge(role, s.id, t.id)).status).toBe(mayMerge ? 200 : 403);
    if (!mayMerge) expect((await merge('owner', s.id, t.id)).status).toBe(200);
    expect((await merges(role, t.id)).status).toBe(mayUnmerge ? 200 : 403);
    expect((await unmerge(role, s.id)).status).toBe(mayUnmerge ? 200 : 403);
    expect(await logOf(s.id)).toEqual([{ live: !mayUnmerge }]);
  });
});

describe('POST /v1/customers/merge and /{id}/unmerge', () => {
  it('lets a Manager of WA only move the ticket and the lead of WB, and gives them back on unmerge (N204)', async () => {
    const [s, t] = [await customer('An'), await customer('Bình')];
    const merged = await merge('manager', s.id, t.id);
    expect(merged.status).toBe(200);
    expect(merged.body['merge']).toMatchObject({
      sourceId: s.id,
      targetId: t.id,
      mergedBy: { id: people['manager'], name: 'Người manager' },
      unmergedAt: null,
    });
    expect(merged.body['target']).toMatchObject({ id: t.id, displayName: 'Bình' });
    expect([await ownerOf('tickets', s.ticket), await ownerOf('leads', s.lead)]).toEqual([
      t.id,
      t.id,
    ]);
    expect((await call('owner', 'GET', `/v1/customers/${s.id}`)).status).toBe(404);

    const undone = await unmerge('owner', s.id);
    expect(undone.status).toBe(200);
    expect(undone.body['merge']).toMatchObject({ id: (merged.body['merge'] as { id: string }).id });
    expect((undone.body['merge'] as { unmergedAt: unknown }).unmergedAt).toEqual(
      expect.any(String),
    );
    expect(undone.body['source']).toMatchObject({ id: s.id, displayName: 'An' });
    expect([await ownerOf('tickets', s.ticket), await ownerOf('leads', s.lead)]).toEqual([
      s.id,
      s.id,
    ]);
  });

  it('answers a repeated key from its record, refuses it with another body, and never merges or unmerges twice', async () => {
    const [s, t, u] = [await customer(), await customer(), await customer()];
    const key = uuidv7();
    const first = await merge('owner', s.id, t.id, key);
    expect(first.status).toBe(200);
    expect(await merge('owner', s.id, t.id, key)).toEqual(first);
    expect(await merge('owner', s.id, u.id, key)).toMatchObject({
      status: 422,
      body: { code: 'idempotency_key_reused' },
    });
    // The same body with a new key: the source is merged already, so it is not a live, unmerged customer (contract J3-0: 404).
    expect((await merge('owner', s.id, t.id)).status).toBe(404);
    expect(await logOf(s.id)).toEqual([{ live: true }]);

    expect((await unmerge('owner', s.id)).status).toBe(200);
    expect(await unmerge('owner', s.id)).toMatchObject({
      status: 409,
      body: { code: 'not_merged' },
    });
    expect(await logOf(s.id)).toEqual([{ live: false }]);
  });

  it('unmerges into a soft deleted target with the target whole, and audits it (N205, CEO 07/11)', async () => {
    const [s, t] = [await customer(), await customer('Cũ')];
    expect((await merge('admin', s.id, t.id)).status).toBe(200);
    await q('UPDATE customers SET deleted_at = now() WHERE id = $1', [t.id]);
    const undone = await unmerge('admin', s.id);
    expect(undone.status).toBe(200);
    expect(undone.body['target']).toEqual({
      id: t.id,
      displayName: 'Cũ',
      phone: null,
      email: null,
      humanOnly: false,
      identities: [],
      tags: [],
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    });
    expect(await ownerOf('tickets', s.ticket)).toBe(s.id);
    expect(await q('SELECT merged_into FROM customers WHERE id = $1', [s.id])).toEqual([
      { merged_into: null },
    ]);
    expect(
      await q(
        `SELECT detail FROM audit_logs WHERE org_id = $1 AND action = 'customer.unmerged_from_deleted_target' AND target_id = $2`,
        [orgA, t.id],
      ),
    ).toEqual([{ detail: { sourceId: s.id, targetId: t.id } }]);
  });

  it('refuses a target merged in turn, an unknown or foreign customer, and the same customer twice', async () => {
    const [s, t, u] = [await customer(), await customer(), await customer()];
    expect((await merge('owner', s.id, t.id)).status).toBe(200);
    expect((await merge('owner', t.id, u.id)).status).toBe(200);
    expect(await unmerge('owner', s.id)).toMatchObject({
      status: 409,
      body: { code: 'target_merged' },
    });
    expect((await merge('owner', u.id, THEIRS)).status).toBe(404);
    expect((await merge('owner', u.id, uuidv7())).status).toBe(404);
    expect((await unmerge('owner', THEIRS)).status).toBe(404);
    expect((await merge('owner', u.id, u.id)).status).toBe(400);
    expect((await unmerge('stranger', s.id)).status).toBe(404);
  });
});

describe('GET /v1/customers/{id}/merges', () => {
  it('lists the merges into a customer, newest first, undone ones too, with who merged and the source name', async () => {
    const [s, t] = [await customer('Nguồn'), await customer()];
    for (const step of [
      () => merge('owner', s.id, t.id),
      () => unmerge('owner', s.id),
      () => merge('admin', s.id, t.id),
    ])
      expect((await step()).status).toBe(200);
    const res = await merges('admin', t.id);
    expect(res.status).toBe(200);
    const rows = res.body['data'] as Record<string, unknown>[];
    expect(rows.map((r) => [r['mergedBy'], r['unmergedAt'] === null, r['sourceName']])).toEqual([
      [{ id: people['admin'], name: 'Người admin' }, true, 'Nguồn'],
      [{ id: people['owner'], name: 'Người owner' }, false, 'Nguồn'],
    ]);
    expect((await merges('admin', s.id)).status).toBe(404);
    expect((await merges('admin', THEIRS)).status).toBe(404);
    expect((await merges('stranger', t.id)).status).toBe(404);
  });
});

describe('GET /v1/customers/{id}/merge-suggestions (J3d)', () => {
  const contact = async (phone: string | null, email: string | null) => {
    const { id } = await customer();
    await q('UPDATE customers SET phone_e164 = $1, email = $2 WHERE id = $3', [phone, email, id]);
    return id;
  };
  const suggest = (key: string, id: string) =>
    call(key, 'GET', `/v1/customers/${id}/merge-suggestions`);

  it('suggests the same phone, email or both exactly, newest first, to who may merge only', async () => {
    const self = await contact('+84933333333', 'goi.y@example.test');
    const byPhone = await contact('+84933333333', null);
    const byEmail = await contact(null, 'goi.y@example.test');
    const byBoth = await contact('+84933333333', 'goi.y@example.test');
    await contact('+8493333333', 'goi.y@example.tes'); // a part of each: never
    await q('UPDATE customers SET phone_e164 = $1 WHERE id = $2', ['+84933333333', THEIRS]);
    for (const role of ROLES) {
      const res = await suggest(role, self);
      expect(res.status, role).toBe(['owner', 'admin', 'manager'].includes(role) ? 200 : 403);
      if (res.status !== 200) continue;
      const rows = res.body['data'] as {
        customer: { id: string; phone: string };
        reasons: string[];
      }[];
      expect(rows.map((r) => [r.customer.id, r.reasons])).toEqual([
        [byBoth, ['phone', 'email']],
        [byEmail, ['email']],
        [byPhone, ['phone']],
      ]);
      expect(rows[0]?.customer.phone).toBe('+84933333333');
    }
    expect((await suggest('owner', uuidv7())).status).toBe(404);
    expect((await suggest('owner', THEIRS)).status).toBe(404);
    expect((await suggest('stranger', self)).status).toBe(404);
  });
});
