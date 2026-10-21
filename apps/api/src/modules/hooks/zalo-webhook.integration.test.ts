import 'reflect-metadata';

import { randomBytes, randomUUID } from 'node:crypto';

import { SecretBox, zaloSignature } from '@gani/channels';
import { createDbPool } from '@gani/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupApp } from '../../app-setup.js';
import { AppModule } from '../../app.module.js';

// POST /v1/hooks/zalo/{channelAccountId} over HTTP with the real application and PostgreSQL (zalo spec §10 Z-N1…Z-N4, Z-N10). The
// webhook is signed as the recorded formula says (Q6: unverified, N139); the OA secret key is stored encrypted by SecretBox.
const need = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set: this test needs PostgreSQL (see the db job of CI)`);
  return value;
};
const [org, ws] = [randomUUID(), randomUUID()];
const [live, cut] = [randomUUID(), randomUUID()];
const APP_ID = '1234567890';
const OA_SECRET = randomBytes(24).toString('base64url');
const KEY = randomBytes(32).toString('hex');
const admin = createDbPool(need('DATABASE_URL_MIGRATION'), { max: 2 });
let app: NestExpressApplication | undefined;
let url = '';

const body = (msgId: string, over: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      app_id: APP_ID,
      event_name: 'user_send_text',
      timestamp: String(Date.now()),
      sender: { id: 'zalo-user-1' },
      message: { msg_id: msgId, text: 'xin chào' },
      ...over,
    }),
  );
const send = (account: string, raw: Buffer, signature?: string) =>
  fetch(`${url}/v1/hooks/zalo/${account}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zevent-signature':
        signature ??
        zaloSignature(
          raw,
          String((JSON.parse(raw.toString()) as { timestamp: string }).timestamp),
          { appId: APP_ID, oaSecretKey: OA_SECRET },
        ),
    },
    body: raw,
  });
const events = async (msgId: string) =>
  (
    await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM inbound_events WHERE platform_message_id = $1',
      [msgId],
    )
  ).rows[0]?.n;

// prettier-ignore
beforeAll(async () => {
  need('DATABASE_URL_APP');
  need('DATABASE_URL_AUTH');
  Object.assign(process.env, { BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: 'http://localhost:3000', APP_ENV: 'test', AUTH_ALLOW_HTTP: 'true', CHANNEL_SECRET_KEY_1: KEY });
  const box = SecretBox.fromEnv({ CHANNEL_SECRET_KEY_1: KEY });
  await admin.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [org, `t-${org}`, 'T']);
  await admin.query(`INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`, [ws, org, `w-${ws}`]);
  for (const [id, status] of [[live, 'connected'], [cut, 'disconnected']] as const)
    await admin.query(
      `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, oa_secret_key_enc, status)
       VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', $5, $6, $7)`,
      [id, org, ws, `oa-${id}`, APP_ID, box.encrypt(OA_SECRET, { rowId: id, column: 'oa_secret_key_enc' }, 1), status],
    );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = (app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }));
  setupApp(nest);
  await nest.listen(0, '127.0.0.1');
  url = await nest.getUrl();
});

// prettier-ignore
afterAll(async () => {
  await app?.close();
  for (const text of ['inbound_events WHERE org_id', 'inbound_event_keys WHERE org_id', 'channel_accounts WHERE org_id', 'workspaces WHERE org_id', 'organizations WHERE id'])
    await admin.query(`DELETE FROM ${text} = $1`, [org]).catch(() => undefined);
  await admin.end();
});

describe('POST /v1/hooks/zalo/{channelAccountId}', () => {
  it('stores a signed event once, answers 200 to a second delivery too, in the tenant of the account (Z-N1, Z-N4)', async () => {
    const msgId = `m-${randomUUID()}`;
    const raw = body(msgId);
    expect((await send(live, raw)).status).toBe(200);
    expect((await send(live, raw)).status).toBe(200);
    expect(await events(msgId)).toBe(1);
    const { rows } = await admin.query(
      'SELECT org_id, workspace_id, channel_account_id, event_type, status FROM inbound_events WHERE platform_message_id = $1',
      [msgId],
    );
    expect(rows).toEqual([
      {
        org_id: org,
        workspace_id: ws,
        channel_account_id: live,
        event_type: 'user_send_text',
        status: 'pending',
      },
    ]);
  });

  it('answers a bad signature, an unknown, disconnected or malformed account alike, and stores nothing (Z-N2, Z-N3)', async () => {
    const msgId = `m-${randomUUID()}`;
    const raw = body(msgId);
    const answers = [];
    for (const [account, signature] of [
      [live, 'mac=' + '0'.repeat(64)],
      [live, ''],
      [randomUUID(), undefined],
      [cut, undefined],
      ['not-a-uuid', undefined],
    ] as const) {
      const res = await send(account, raw, signature);
      const json = (await res.json()) as Record<string, unknown>;
      answers.push([res.status, res.headers.get('content-type'), json['code'], json['detail']]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual([
      401,
      'application/problem+json',
      'unauthorized',
      'The webhook could not be verified.',
    ]);
    expect(await events(msgId)).toBe(0);
    expect((await send(live, Buffer.from('not json'), 'mac=' + '0'.repeat(64))).status).toBe(401);
  });

  it('refuses a body over 256 KiB with 413 before reading the account', async () => {
    const res = await send(live, body('big', { pad: 'x'.repeat(300 * 1024) }));
    expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([
      413,
      'payload_too_large',
    ]);
  });

  it('answers within a few milliseconds on a local database (Z-N10: measured, not a condition)', async () => {
    const times: number[] = [];
    for (let n = 0; n < 40; n++) {
      const started = performance.now();
      expect((await send(live, body(`m-${randomUUID()}`))).status).toBe(200);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    console.info(`zalo webhook p50=${times[19]?.toFixed(1)}ms p95=${times[37]?.toFixed(1)}ms`);
    expect(times.length).toBe(40);
  });
});
