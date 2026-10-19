import 'reflect-metadata';

import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@gani/domain';
import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, describe, expect, it } from 'vitest';

import { setupApp } from './app-setup.js';
import { AppModule } from './app.module.js';
import { buildAuthOptions } from './modules/auth/auth.config.js';
import { loadAuthEnv } from './modules/auth/auth.env.js';
import { AuthService } from './modules/auth/auth.service.js';
import { hashPassword } from './modules/auth/password.js';
import { revokingAdapter } from './modules/auth/revoking-adapter.js';
import { ConversationNotFoundError } from './modules/conversations/errors.js';
import { DatabaseService } from './modules/database/database.service.js';
import { PROBLEM_CONTENT_TYPE } from './modules/request-context/problem.js';
import { SECURITY_HEADERS } from './modules/request-context/security-headers.js';
import { currentRequestContext } from './modules/request-context/request-context.js';

// The order the application is put together in (N90), on real Nest and real Better Auth with the in-memory adapter and stub databases.
@Controller('v1')
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown) {
    return { body };
  }

  // AR-03: an error of ours with a status, and one nobody planned for whose message must not reach the client.
  @Post('test/missing')
  missing(): never {
    throw new ConversationNotFoundError();
  }

  @Post('test/boom')
  boom(): never {
    throw new Error(`Failed query: select 1 params: ${EMAIL}`);
  }

  // What the tenant middleware made for this request, read after Nest's router and body parser have run.
  @Post('test/context')
  context(@Body() body: unknown) {
    return { body, ctx: currentRequestContext() };
  }
}

const ORG = uuidv7();
const WORKSPACE = uuidv7();

/** Answers the two queries of readMemberContext (the role, then the workspaces) in order, whatever the builder chain. */
function fakeTx(results: object[][]) {
  let next = 0;
  return {
    select: () => {
      const rows = results[next++] ?? [];
      const query: Record<string, unknown> = {};
      for (const step of ['from', 'innerJoin', 'where']) query[step] = () => query;
      query['then'] = (resolve: (value: object[]) => unknown) => resolve(rows);
      return query;
    },
  };
}

const EMAIL = 'person@example.test';
const PW = randomBytes(18).toString('base64url');
let app: INestApplication | undefined;

async function start(mustSetUp = false): Promise<string> {
  const base = 'http://localhost:3000';
  const env = loadAuthEnv({
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: base,
    APP_ENV: 'test',
    AUTH_ALLOW_HTTP: 'true',
  });
  const db = {
    user: [] as object[],
    session: [] as object[],
    account: [] as object[],
    verification: [] as object[],
    twoFactor: [] as object[],
  };
  const auth = betterAuth(buildAuthOptions(env, revokingAdapter(memoryAdapter(db))));
  const [id, now] = [uuidv7(), new Date()];
  db.user.push({
    id,
    email: EMAIL,
    name: 'P',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  db.account.push({
    id: uuidv7(),
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword(PW),
    createdAt: now,
    updatedAt: now,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [EchoController],
  })
    .overrideProvider(DatabaseService)
    .useValue({
      ping: () => Promise.resolve(true),
      withTenant: (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn(fakeTx([[{ role: 'sales' }], [{ id: WORKSPACE }]])),
    })
    .overrideProvider(AuthService)
    .useValue({
      auth,
      ping: () => Promise.resolve(true),
      activeOrganisationIds: () => Promise.resolve([ORG]),
      mustSetUpTwoFactor: () => Promise.resolve(mustSetUp),
      twoFactorStatus: () =>
        Promise.resolve({ twoFactorEnabled: false, required: mustSetUp, mustSetUp }),
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  return nest.getUrl();
}

const json = (url: string, path: string, body: object, cookie?: string) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('setupApp', () => {
  it('serves Better Auth at /api/auth: the library reads its own body, a wrong password is 401 and a right one a session', async () => {
    const url = await start();
    expect((await fetch(`${url}/api/auth/ok`)).status).toBe(200);
    expect(
      (await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: `${PW}x` })).status,
    ).toBe(401);
    const ok = await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: PW });
    expect(ok.status).toBe(200);
    const cookie = ok.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    expect(cookie).toContain('better-auth.session_token=');
    const session = await fetch(`${url}/api/auth/get-session`, { headers: { cookie } });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(EMAIL);
  });

  it('still gives its own JSON body to the routes that are not Better Auth, and /healthz keeps answering', async () => {
    const url = await start();
    const signedIn = await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: PW });
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const echoed = await json(url, '/v1/echo', { hello: 'world' }, cookie);
    expect(await echoed.json()).toEqual({ body: { hello: 'world' } });
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });

  it('puts the tenant middleware on /v1 after the parser: no session is 401 RFC 9457, a session gets its context past the router with its body', async () => {
    const url = await start();
    const anonymous = await json(url, '/v1/test/context', { hello: 'world' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    const signedIn = await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: PW });
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const res = await json(url, '/v1/test/context', { hello: 'world' }, cookie);
    expect(res.status).toBe(201);
    const answer = (await res.json()) as { body: unknown; ctx: Record<string, unknown> };
    expect(answer.body).toEqual({ hello: 'world' });
    expect(answer.ctx).toMatchObject({ orgId: ORG, role: 'sales', workspaceIds: [WORKSPACE] });
  });

  it('leaves /api/auth and /healthz outside the tenant middleware', async () => {
    const url = await start();
    expect((await fetch(`${url}/api/auth/ok`)).status).toBe(200);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });

  it('puts the 2FA gate in front of Better Auth and of /v1, and serves /v1/me/security-status past it', async () => {
    const url = await start(true);
    const signedIn = await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: PW });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const blocked = await fetch(`${url}/api/auth/get-session`, { headers: { cookie } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: 'two_factor_setup_required' });
    expect((await json(url, '/v1/test/context', {}, cookie)).status).toBe(403);
    const status = await fetch(`${url}/v1/ME/security-status`, { headers: { cookie } });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      twoFactorEnabled: false,
      required: true,
      mustSetUp: true,
    });
    const anonymous = await fetch(`${url}/v1/me/security-status`);
    expect(anonymous.status).toBe(401);
    // Express adds the charset to the type the controller set.
    expect(anonymous.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
  });
});

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('the edge of the HTTP server (AR-03, AR-04, SEC-03)', () => {
  it('sends the security headers on every kind of answer, and no X-Powered-By', async () => {
    const url = await start();
    const answers = [
      await fetch(`${url}/healthz`),
      await fetch(`${url}/api/auth/ok`),
      await json(url, '/v1/echo', {}),
      await fetch(`${url}/nope`),
    ];
    expect(answers.map((r) => r.status)).toEqual([200, 200, 401, 404]);
    for (const res of answers) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(res.headers.get(name), `${res.url} ${name}`).toBe(value);
      }
      expect(res.headers.get('x-powered-by'), res.url).toBeNull();
    }
  });

  it('answers every error as RFC 9457: an unknown route, a malformed body, an error of ours, one nobody planned for', async () => {
    const url = await start();
    const cookie = cookieOf(
      await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: PW }),
    );
    const notFound = await fetch(`${url}/nope`);
    expect(notFound.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
    expect(await notFound.json()).toMatchObject({ status: 404, code: 'not_found' });
    const malformed = await fetch(`${url}/v1/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{"not json',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ status: 400, code: 'validation_failed' });
    const missing = await json(url, '/v1/test/missing', {}, cookie);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ status: 404, code: 'not_found' });
    const boom = await json(url, '/v1/test/boom', {}, cookie);
    expect(boom.status).toBe(500);
    const text = await boom.text();
    expect(JSON.parse(text)).toMatchObject({ status: 500, code: 'internal_error' });
    expect(JSON.parse(text)).toHaveProperty('traceId');
    for (const secret of [EMAIL, 'Failed query']) expect(text).not.toContain(secret);
  });

  it('keeps the session token out of the JSON of sign-in and get-session; the cookie still works', async () => {
    const url = await start();
    const signedIn = await json(url, '/api/auth/sign-in/email', { email: EMAIL, password: PW });
    expect(signedIn.status).toBe(200);
    const body = (await signedIn.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('token');
    expect(body).toHaveProperty('user');
    const read = await fetch(`${url}/api/auth/get-session`, {
      headers: { cookie: cookieOf(signedIn) },
    });
    const session = (await read.json()) as {
      session: Record<string, unknown>;
      user: { email: string };
    };
    expect(session.user.email).toBe(EMAIL);
    expect(session.session).toHaveProperty('id');
    expect(session.session).not.toHaveProperty('token');
  });
});
