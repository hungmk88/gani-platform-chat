import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module.js';
import { HealthController } from './health.controller.js';

describe('GET /healthz', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 200 {"status":"ok"} over HTTP', async () => {
    const response = await fetch(`${await app.getUrl()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('injects HealthService into the controller (decorator metadata is emitted)', () => {
    // If the test transformer dropped design:paramtypes, `health` would be undefined and this throws.
    expect(app.get(HealthController).check()).toEqual({ status: 'ok' });
  });
});
