import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';

// GET /v1/me (U32, N145) over HTTP with Better Auth and PostgreSQL as in production. Org A: W1 "Bán sỉ", W2 "Bán lẻ", a deleted W3, W4;
// org B: WB. People: a platform operator of no organisation, a manager of A in W1, W2 and W3 (not W4), a sales of A with no name and no
// workspace, a member of A and B who chose neither, a suspended member of A, an owner of A without a second factor, a manager of B.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const ORIGIN = 'http://localhost:3000';
const [orgA, orgB, W1, W2, W3, W4, WB] = [
  randomUUID(),
  randomUUID(),
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
let app: NestExpressApplication | undefined;
let url = '';
const q = (text: string, params: unknown[]) => admin.query(text, params);
type Membership = [org: string, role: string, status: string, workspaces: string[]];

// prettier-ignore
async function person(key: string, hash: string, name: string | null, memberships: Membership[], operator = false) {
  const id = (people[key] = randomUUID());
  await q(`INSERT INTO users (id, email, status, email_verified_at, display_name, is_platform_operator) VALUES ($1, $2, 'active', now(), $3, $4)`, [id, `${id}@example.test`, name, operator]);
  await q(`INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), id, id, hash]);
  for (const [org, role, status, spaces] of memberships) {
    await q(`INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), org, id, role, status]);
    for (const ws of spaces)
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
const get = (who: string | null, path = '/v1/me') =>
  fetch(`${url}${path}`, { headers: who ? { cookie: cookies[who] ?? '' } : {} });
const me = async (who: string) => {
  const res = await get(who);
  expect(res.status, who).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: ORIGIN, APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true' });
  const hash = await hashPassword(PW);
  for (const [org, name] of [[orgA, 'Gani A'], [orgB, 'Gani B']] as const)
    await q('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, name]);
  for (const [ws, org, name, deleted] of [[W1, orgA, 'Bán sỉ', false], [W2, orgA, 'Bán lẻ', false], [W3, orgA, 'Cũ', true], [W4, orgA, 'Kho', false], [WB, orgB, 'B', false]] as const)
    await q(`INSERT INTO workspaces (id, org_id, slug, name, template, deleted_at) VALUES ($1, $2, $3, $4, 'service', $5)`, [ws, org, `w-${ws}`, name, deleted ? new Date() : null]);
  await q(`UPDATE workspaces SET contact_phone = '028 3812 3456' WHERE id = $1`, [W1]);
  await person('operator', hash, 'Op', [], true);
  await person('manager', hash, 'Lan', [[orgA, 'manager', 'active', [W1, W2, W3]]]);
  await person('nameless', hash, null, [[orgA, 'sales', 'active', []]]);
  await person('both', hash, 'Hai', [[orgA, 'sales', 'active', [W1]], [orgB, 'sales', 'active', [WB]]]);
  await person('suspended', hash, 'Tạm', [[orgA, 'sales', 'suspended', [W1]]]);
  await person('owner', hash, 'Chủ', [[orgA, 'owner', 'active', [W1]]]);
  await person('seller', hash, 'Bán', [[orgA, 'sales', 'active', [W1]]]);
  await person('stranger', hash, 'Khác', [[orgB, 'manager', 'active', [WB]]]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
  for (const key of Object.keys(people)) cookies[key] = await login(key);
  // Signed in first: once the factor is on, /sign-in/email asks for the second step and issues no cookie (as in two-factor-gate).
  await q('UPDATE users SET two_factor_enabled = true WHERE id = $1', [people['operator']]);
}, 60_000);

// prettier-ignore
afterAll(async () => {
  await app?.close();
  const [users, orgs] = [Object.values(people), [orgA, orgB]];
  for (const [text, ids] of [
    ['sessions WHERE user_id', users], ['workspace_members WHERE org_id', orgs], ['workspaces WHERE org_id', orgs],
    ['org_members WHERE org_id', orgs], ['organizations WHERE id', orgs], ['accounts WHERE user_id', users], ['users WHERE id', users],
  ] as const)
    await q(`DELETE FROM ${text} = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  await admin.end();
});

describe('GET /v1/me', () => {
  it('names a member, their role, their organisation and its live workspaces they belong to, by name, with their contact number', async () => {
    expect(await me('manager')).toEqual({
      id: people['manager'],
      name: 'Lan',
      isPlatformOperator: false,
      org: { id: orgA, name: 'Gani A', role: 'manager' },
      workspaces: [
        { id: W2, name: 'Bán lẻ', contactPhone: null },
        { id: W1, name: 'Bán sỉ', contactPhone: '028 3812 3456' },
      ],
    });
    // Sales reads the number too (U37): they fill {{company_phone}} of a quick reply with it.
    expect(await me('seller')).toMatchObject({
      org: { id: orgA, role: 'sales' },
      workspaces: [{ id: W1, name: 'Bán sỉ', contactPhone: '028 3812 3456' }],
    });
    expect(await me('stranger')).toEqual({
      id: people['stranger'],
      name: 'Khác',
      isPlatformOperator: false,
      org: { id: orgB, name: 'Gani B', role: 'manager' },
      workspaces: [{ id: WB, name: 'B', contactPhone: null }],
    });
  });

  it('answers a platform operator of no organisation with org null, while the other /v1 routes refuse them', async () => {
    expect(await me('operator')).toEqual({
      id: people['operator'],
      name: 'Op',
      isPlatformOperator: true,
      org: null,
      workspaces: [],
    });
    const other = await get('operator', '/v1/conversations');
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'no_organisation' });
  });

  it('answers org null to a member of two organisations who chose none, and to a suspended member', async () => {
    expect(await me('both')).toMatchObject({ name: 'Hai', org: null, workspaces: [] });
    expect(await me('suspended')).toMatchObject({ name: 'Tạm', org: null, workspaces: [] });
  });

  it('gives the email as the name of a person who has none', async () => {
    expect(await me('nameless')).toMatchObject({
      name: `${people['nameless']}@example.test`,
      org: { id: orgA, role: 'sales' },
      workspaces: [],
    });
  });

  it('refuses a request with no session (401) and a person who must set up 2FA first (403), as problem+json', async () => {
    const anonymous = await get(null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('content-type')).toContain('application/problem+json');
    expect(await anonymous.json()).toMatchObject({
      code: 'unauthorized',
      traceId: expect.any(String) as string,
    });
    const owner = await get('owner');
    expect(owner.status).toBe(403);
    expect(await owner.json()).toMatchObject({ code: 'two_factor_setup_required' });
  });
});

describe('PATCH /v1/me', () => {
  const patch = (who: string | null, body: unknown, origin: string | null = ORIGIN) =>
    fetch(`${url}/v1/me`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(who ? { cookie: cookies[who] ?? '' } : {}),
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    });

  it('renames the signed-in person only, trimmed, and answers as GET /v1/me', async () => {
    const res = await patch('nameless', { name: '  Ngọc  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: people['nameless'],
      name: 'Ngọc',
      org: { id: orgA },
    });
    expect(await me('nameless')).toMatchObject({ name: 'Ngọc' });
    expect(await me('manager')).toMatchObject({ name: 'Lan' });
    // A name is the person's own, not an organisation's: an operator of none renames themselves too.
    expect((await patch('operator', { name: 'Vận hành' })).status).toBe(200);
  });

  it('refuses no session, another origin, a person who must set up 2FA, and a bad name, and changes nothing', async () => {
    const answers = [
      await patch(null, { name: 'X' }),
      await patch('manager', { name: 'X' }, 'https://evil.example'),
      await patch('owner', { name: 'X' }),
      await patch('manager', { name: '   ' }),
      await patch('manager', { name: 'x'.repeat(101) }),
      await patch('manager', { name: 'X', id: people['stranger'] }),
    ];
    expect(answers.map((a) => a.status)).toEqual([401, 403, 403, 400, 400, 400]);
    const names = await q(
      'SELECT id, display_name FROM users WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[people['manager'], people['owner'], people['stranger']]],
    );
    expect(names.rows.map((r) => (r as { display_name: string }).display_name).sort()).toEqual([
      'Chủ',
      'Khác',
      'Lan',
    ]);
  });
});
