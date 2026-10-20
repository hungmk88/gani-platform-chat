import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { SecretBox, zaloSignature } from '@gani/channels';
import type { NewInboundEvent, TenantTx, WebhookChannelAccount } from '@gani/db';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBuckets } from './token-bucket.js';
import { createZaloWebhook, type ZaloWebhookDeps } from './zalo-webhook.js';

// The webhook on fakes: the steps a real database does not reach (rate limit, an account not set up, a failure past the checks).
const ID = '0190a000-0000-7000-8000-000000000001';
const secrets = { appId: '42', oaSecretKey: 'oa-secret' };
const box = new SecretBox(new Map([[1, randomBytes(32)]]));
const account = (over: Partial<WebhookChannelAccount> = {}): WebhookChannelAccount => ({
  orgId: 'org',
  workspaceId: 'ws',
  type: 'zalo_oa',
  status: 'connected',
  keyVersion: 1,
  appId: secrets.appId,
  appSecretEnc: null,
  oaSecretKeyEnc: box.encrypt(secrets.oaSecretKey, { rowId: ID, column: 'oa_secret_key_enc' }, 1),
  ...over,
});
let server: Server;
let url = '';
const stored: NewInboundEvent[] = [];

async function start(over: Partial<ZaloWebhookDeps> = {}) {
  const handler = createZaloWebhook({
    account: () => Promise.resolve(account()),
    secrets: box,
    withTenant: (_ctx, fn) => fn({} as TenantTx),
    insert: (_tx, event) => (stored.push(event), Promise.resolve('inserted')),
    ...over,
  });
  server = createServer(
    (req, res) => void handler(Object.assign(req, { params: { channelAccountId: ID } }), res),
  );
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}
const signedPost = () => {
  const ts = String(Date.now());
  const raw = Buffer.from(
    JSON.stringify({ event_name: 'user_send_text', timestamp: ts, message: { msg_id: 'm-1' } }),
  );
  return fetch(url, {
    method: 'POST',
    headers: { 'x-zevent-signature': zaloSignature(raw, ts, secrets) },
    body: raw,
  });
};

beforeEach(() => {
  stored.length = 0;
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

describe('createZaloWebhook', () => {
  it('stores the verified event under the platform message id and answers 200', async () => {
    await start();
    expect((await signedPost()).status).toBe(200);
    expect(stored).toMatchObject([
      {
        workspaceId: 'ws',
        channelAccountId: ID,
        platformMessageId: 'm-1',
        eventType: 'user_send_text',
      },
    ]);
  });

  it('answers 429 rate_limited once the bucket of the account is empty, before reading anything', async () => {
    const reads = vi.fn(() => Promise.resolve(account()));
    await start({ account: reads, buckets: new TokenBuckets({ perSecond: 0.001, burst: 1 }) });
    expect((await signedPost()).status).toBe(200);
    const second = await signedPost();
    expect([second.status, ((await second.json()) as { code: string }).code]).toEqual([
      429,
      'rate_limited',
    ]);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('refuses an account without an app id or an OA secret key like an unknown one', async () => {
    for (const over of [{ appId: null }, { oaSecretKeyEnc: null }, { type: 'facebook' }]) {
      await start({ account: () => Promise.resolve(account(over)) });
      expect((await signedPost()).status, JSON.stringify(over)).toBe(401);
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
    await start();
  });

  it('answers 500 with a code in the log, never the error message, when a step past the checks fails', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await start({
      insert: () =>
        Promise.reject(
          Object.assign(new Error('connection to db-7 password=x'), { code: '57P01' }),
        ),
    });
    const res = await signedPost();
    expect([res.status, ((await res.json()) as { code: string }).code]).toEqual([
      500,
      'internal_error',
    ]);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/^webhook failed \(57P01\) trace=/);
    expect(String(error.mock.calls[0]?.[0])).not.toContain('password');
  });

  it('answers 500 when the OA secret key does not decrypt (another key version on the row)', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await start({ account: () => Promise.resolve(account({ keyVersion: 7 })) });
    expect((await signedPost()).status).toBe(500);
  });
});
