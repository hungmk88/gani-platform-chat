import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { createDbPool } from '@gani/db';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseModule } from '../database/database.module.js';
import { ProblemFilter } from '../request-context/problem.filter.js';
import { runWithRequestContext } from '../request-context/request-context.js';
import { Idempotent } from './idempotency.interceptor.js';

// The Idempotency-Key interceptor on PostgreSQL (N134): the routes exist only here, and a stub stands in for the tenant middleware.
const runs = { made: 0, refused: 0, broken: 0 };
let release: () => void = () => undefined;

@Controller('v1/t')
class TestController {
  @Post('make')
  @Idempotent()
  make(@Body() body: unknown) {
    return { n: ++runs.made, body };
  }

  @Post('accept')
  @HttpCode(202)
  @Idempotent()
  accept() {
    return { n: ++runs.made };
  }

  @Post('refuse')
  @Idempotent()
  refuse() {
    runs.refused++;
    throw Object.assign(new Error('Taken by someone else.'), { status: 409, code: 'taken' });
  }

  @Post('break')
  @Idempotent()
  broken() {
    runs.broken++;
    if (runs.broken === 1) throw new Error('the database went away');
    return { ok: true };
  }

  @Post('slow')
  @Idempotent()
  async slow() {
    await new Promise<void>((done) => (release = done));
    return { slow: true };
  }
}

const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [org, user] = [randomUUID(), randomUUID()];
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
let app: NestExpressApplication;
let url = '';

const post = (path: string, key: string | null, body: unknown = {}) =>
  fetch(`${url}/v1/t/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    body: JSON.stringify(body),
  });
const answer = async (res: Response) => ({
  status: res.status,
  type: res.headers.get('content-type'),
  body: await res.json(),
});

beforeAll(async () => {
  need('DATABASE_URL_APP');
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    org,
    `t-${org}`,
    'T',
  ]);
  await admin.query(
    `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
    [user, `${user}@example.test`],
  );
  const moduleRef = await Test.createTestingModule({
    imports: [DatabaseModule],
    controllers: [TestController],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use((_req: unknown, _res: unknown, next: () => void) =>
    runWithRequestContext(
      {
        userId: user,
        orgId: org,
        role: 'sales',
        workspaceIds: [],
        resolvedAt: new Date(),
        traceId: randomUUID(),
      },
      next,
    ),
  );
  app.useGlobalFilters(new ProblemFilter());
  await app.listen(0, '127.0.0.1');
  url = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  // Children first (foreign keys); the CI database is ephemeral, so a failing step is swallowed.
  for (const [text, id] of [
    ['DELETE FROM idempotency_keys WHERE org_id = $1', org],
    ['DELETE FROM organizations WHERE id = $1', org],
    ['DELETE FROM users WHERE id = $1', user],
  ] as const)
    await admin.query(text, [id]).catch(() => undefined);
  await admin.end();
});

describe('Idempotency-Key over HTTP', () => {
  it('runs the handler once and gives back the same answer (status and JSON), to the same request sent again', async () => {
    const [key, other] = [randomUUID(), randomUUID()];
    const first = await answer(await post('make', key, { b: 1, a: [2] }));
    expect(first).toMatchObject({ status: 201 });
    expect(await answer(await post('make', key, { a: [2], b: 1 }))).toEqual(first);
    expect(runs.made).toBe(1);
    const accepted = await post('accept', other);
    expect([accepted.status, (await post('accept', other)).status, runs.made]).toEqual([
      202, 202, 2,
    ]);
    const kept = await admin.query('SELECT response_status FROM idempotency_keys WHERE key = $1', [
      other,
    ]);
    expect(kept.rows).toEqual([{ response_status: 202 }]);
  });

  it('refuses a request without a key, or with one that is not 1 to 255 printable characters', async () => {
    for (const key of [null, '', 'has space', 'x'.repeat(256)]) {
      const res = await post('make', key);
      expect(res.status, String(key)).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'validation_failed' });
    }
    expect(runs.made).toBe(2);
  });

  it('answers 422 idempotency_key_reused for the key with another body or path', async () => {
    const key = randomUUID();
    await post('make', key, { a: 1 });
    for (const res of [await post('make', key, { a: 2 }), await post('accept', key, { a: 1 })]) {
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'idempotency_key_reused' });
    }
  });

  it('gives back a 4xx as it was without running the handler again', async () => {
    const key = randomUUID();
    const first = await answer(await post('refuse', key));
    expect(first.status).toBe(409);
    expect(first.type).toContain('application/problem+json');
    expect(first.body).toMatchObject({
      code: 'taken',
      detail: 'Taken by someone else.',
    });
    expect(await answer(await post('refuse', key))).toEqual(first);
    expect(runs.refused).toBe(1);
  });

  it('keeps no 5xx: the same key runs the handler again', async () => {
    const key = randomUUID();
    expect((await post('break', key)).status).toBe(500);
    const again = await post('break', key);
    expect([again.status, await again.json(), runs.broken]).toEqual([201, { ok: true }, 2]);
  });

  it('answers 409 idempotency_in_progress while the first request with the key still runs', async () => {
    const key = randomUUID();
    const first = post('slow', key);
    await expect
      .poll(() =>
        admin.query('SELECT 1 FROM idempotency_keys WHERE key = $1', [key]).then((r) => r.rowCount),
      )
      .toBe(1);
    const second = await post('slow', key);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'idempotency_in_progress' });
    release();
    expect((await first).status).toBe(201);
    expect(await (await post('slow', key)).json()).toEqual({ slow: true });
  });
});
