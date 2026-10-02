import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import { HealthController } from './health.controller.js';

let app: INestApplication | undefined;

/** The real AppModule, with the database replaced by a stub that answers `ping()` as given. */
async function start(ping: () => Promise<boolean>): Promise<string> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ ping })
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /healthz', () => {
  it('answers 200 {"status":"ok"} over HTTP', async () => {
    const response = await fetch(`${await start(() => Promise.resolve(true))}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('still answers 200 when the database is down (liveness never checks dependencies)', async () => {
    const response = await fetch(`${await start(() => Promise.resolve(false))}/healthz`);
    expect(response.status).toBe(200);
  });

  it('injects HealthService into the controller (decorator metadata is emitted)', async () => {
    await start(() => Promise.resolve(true));
    // If the test transformer dropped design:paramtypes, `health` would be undefined and this throws.
    expect(app?.get(HealthController).check()).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('answers 200 {"status":"ok"} when the database answers', async () => {
    const response = await fetch(`${await start(() => Promise.resolve(true))}/readyz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 {"status":"unavailable"} when it does not', async () => {
    const response = await fetch(`${await start(() => Promise.resolve(false))}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('answers a generic 500 and leaks nothing if the check itself breaks (a bug, not "down")', async () => {
    const secret = 'password authentication failed for user app_role at 10.0.0.5';
    const url = await start(() => Promise.reject(new Error(secret)));
    const response = await fetch(`${url}/readyz`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(secret);
  });
});
