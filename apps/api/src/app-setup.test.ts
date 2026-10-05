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
import { DatabaseService } from './modules/database/database.service.js';

// The order the application is put together in (N90), on real Nest and real Better Auth with the in-memory adapter and stub databases.
@Controller('v1')
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown) {
    return { body };
  }
}

const EMAIL = 'person@example.test';
const PW = randomBytes(18).toString('base64url');
let app: INestApplication | undefined;

async function start(): Promise<string> {
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
    .useValue({ ping: () => Promise.resolve(true) })
    .overrideProvider(AuthService)
    .useValue({ auth, ping: () => Promise.resolve(true) })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  setupApp(nest, auth);
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
    const echoed = await json(url, '/v1/echo', { hello: 'world' });
    expect(await echoed.json()).toEqual({ body: { hello: 'world' } });
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
  });
});
