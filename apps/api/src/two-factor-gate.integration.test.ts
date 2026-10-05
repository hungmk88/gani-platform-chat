import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createDbPool } from '@gani/db';
import { Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { hashPassword } from './modules/auth/password.js';
import { currentRequestContext } from './modules/request-context/request-context.js';

// N89 checklist (c) and N93 over HTTP with both real pools on PostgreSQL: the 2FA gate at the edge, the rule from the database.
// The route exists only here.
@Controller('v1')
class ProtectedController {
  @Post('test/protected')
  protectedRoute() {
    return { ctx: currentRequestContext() };
  }
}

const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const org = randomUUID();
const PW = randomBytes(18).toString('base64url');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
const people: Record<string, { id: string; email: string }> = {};
let app: NestExpressApplication;
let url = '';
let port = 0;
// Signed in BEFORE two_factor_enabled is set: once it is, /sign-in/email asks for the second step and issues no session cookie.
let ownerYesCookie = '';

async function person(key: string, role: string | null) {
  const id = randomUUID();
  people[key] = { id, email: `${id}@example.test` };
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [id, people[key]?.email],
  );
  await admin.query(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
    [randomUUID(), id, id, await hashPassword(PW)],
  );
  if (role) {
    await admin.query(
      `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, $4, 'active')`,
      [randomUUID(), org, id, role],
    );
  }
}
async function login(key: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: people[key]?.email, password: PW }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
/** A request with the path exactly as written: fetch and `new URL` normalise dot segments on the client. */
const raw = (cookie: string, path: string, method = 'GET') =>
  new Promise<{ status: number; json: Record<string, unknown> | null }>((done, fail) => {
    const headers = { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' };
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => (text += chunk.toString()));
      res.on('end', () => {
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          // A body that is not JSON (an array parses, an empty one does not) is not what these tests look at.
        }
        done({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', fail).end(method === 'POST' ? '{}' : undefined);
  });
const CODE = 'TWO_FACTOR_SETUP_REQUIRED';

beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, {
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'http://localhost:3000',
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    org,
    `t-${org}`,
    'T',
  ]);
  await person('ownerNo', 'owner');
  await person('ownerYes', 'owner');
  await person('viewer', 'viewer');
  await person('nobody', null);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProtectedController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
  port = (app.getHttpServer().address() as AddressInfo).port;
  ownerYesCookie = await login('ownerYes');
});

afterAll(async () => {
  await app.close();
  const ids = Object.values(people).map((p) => p.id);
  // The order is required by the foreign keys (children first). A failing step is swallowed because the CI database is ephemeral.
  const steps: [string, unknown[]][] = [
    ['DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [ids]],
    ['DELETE FROM org_members WHERE org_id = $1', [org]],
    ['DELETE FROM organizations WHERE id = $1', [org]],
    ['DELETE FROM accounts WHERE user_id = ANY($1::uuid[])', [ids]],
    ['DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]],
  ];
  for (const [text, params] of steps) await admin.query(text, params).catch(() => undefined);
  await admin.end();
});

describe('the 2FA gate over HTTP (N89 (c))', () => {
  it('turns away an owner who has not set up a second factor, from /v1 and from /api/auth', async () => {
    const cookie = await login('ownerNo');
    for (const [path, method] of [
      ['/v1/test/protected', 'POST'],
      ['/api/auth/list-sessions', 'GET'],
      ['/api/auth/switch-org', 'POST'],
    ] as const) {
      const res = await raw(cookie, path, method);
      expect(res.status, path).toBe(403);
      expect(res.json, path).toMatchObject({ code: CODE });
    }
  });

  it('lets an owner who has a second factor in; the rule is read at every request, not at sign-in', async () => {
    const cookie = ownerYesCookie;
    expect((await raw(cookie, '/v1/test/protected', 'POST')).status).toBe(403);
    await admin.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [
      people['ownerYes']?.id,
    ]);
    const res = await raw(cookie, '/v1/test/protected', 'POST');
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ ctx: { orgId: org, role: 'owner' } });
  });

  it('lets a viewer in: the rule does not apply to them', async () => {
    const res = await raw(await login('viewer'), '/v1/test/protected', 'POST');
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ ctx: { orgId: org, role: 'viewer' } });
  });

  it('serves /v1/me/security-status to everyone with a session, in any letter case, without an organisation', async () => {
    const want = {
      ownerNo: { twoFactorEnabled: false, required: true, mustSetUp: true },
      ownerYes: { twoFactorEnabled: true, required: true, mustSetUp: false },
      viewer: { twoFactorEnabled: false, required: false, mustSetUp: false },
      nobody: { twoFactorEnabled: false, required: false, mustSetUp: false },
    };
    for (const [key, status] of Object.entries(want)) {
      if (key === 'ownerYes') {
        // Idempotent: this test does not depend on the one above having run.
        await admin.query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [
          people[key]?.id,
        ]);
      }
      const cookie = key === 'ownerYes' ? ownerYesCookie : await login(key);
      for (const path of [
        '/v1/me/security-status',
        '/V1/me/security-status',
        '/v1/ME/SECURITY-STATUS',
      ]) {
        const res = await raw(cookie, path);
        expect(res.status, `${key} ${path}`).toBe(200);
        expect(res.json, `${key} ${path}`).toEqual(status);
      }
    }
    const anonymous = await raw('', '/v1/me/security-status');
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  describe('whitelist paths', () => {
    const TRAVERSAL = '/api/auth/two-factor/enable/../../list-sessions';

    it('refuses to reach list-sessions through an open route, and lets the normalised open route through', async () => {
      const cookie = await login('ownerNo');
      const traversal = await raw(cookie, TRAVERSAL);
      expect(traversal.status).toBe(403);
      expect(traversal.json).toMatchObject({ code: CODE });
      // Past the gate it is Better Auth's own answer to an enable request without a password, whatever that is, but never ours.
      const enable = await raw(cookie, '/api/auth/./two-factor/enable', 'POST');
      expect(enable.json?.['code']).not.toBe(CODE);
      expect(enable.status).not.toBe(404);
    });

    it('control: the same paths are not blocked for a person the rule does not hold back', async () => {
      for (const key of ['viewer', 'nobody']) {
        const cookie = await login(key);
        const res = await raw(cookie, TRAVERSAL);
        expect(res.status, key).toBe(200);
        expect(
          (await raw(cookie, '/api/auth/./two-factor/enable', 'POST')).json?.['code'],
        ).not.toBe(CODE);
      }
    });

    it('lets a person who has to set up sign out', async () => {
      expect((await raw(await login('ownerNo'), '/api/auth/sign-out', 'POST')).status).toBe(200);
    });
  });

  it('a person with no organisation is turned away by the tenant middleware, not by the gate', async () => {
    const res = await raw(await login('nobody'), '/v1/test/protected', 'POST');
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: 'NO_ORGANISATION' });
  });
});
