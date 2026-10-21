import { randomBytes } from 'node:crypto';

import { SecretBox, zaloSignature } from '@gani/channels';
import { uuidv7 } from '@gani/domain';
import { hash } from '@node-rs/argon2';
import { io, type Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';

import { API_ORIGIN, spawnApi, type ApiProcess } from './api.js';
import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { removeInbound } from './inbound.js';
import { useQueueSuite } from './suite.js';

// The whole slice, every part a real process or server (V8c): a signed Zalo webhook to the API → inbound_events → the worker stores the
// message and its outbox events → relay → queue of the workspace → consumer → realtime emitter on Valkey → the redis adapter of the
// API → the socket of an agent. An agent of another workspace of the same organisation gets nothing of it.
const suite = useQueueSuite();

type Packet = {
  eventId: string;
  type: string;
  aggregateVersion: number | null;
  data: Record<string, unknown>;
};

describe('webhook to socket', () => {
  it('brings a customer message to the agents of its workspace only: the summary to the workspace, the whole message to the conversation', async () => {
    const { admin } = suite;
    const org = await suite.newOrg();
    const [W1, W2, account, account2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const key = randomBytes(32).toString('hex');
    const [appId, oaSecret, PW] = [
      `app-${uuidv7()}`,
      randomBytes(16).toString('hex'),
      randomBytes(18).toString('base64url'),
    ];
    const people: Record<string, string> = {};
    const sockets: Socket[] = [];
    let api: ApiProcess | undefined;
    try {
      for (const ws of [W1, W2])
        await admin.query(
          `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
          [ws, org, `w-${ws}`],
        );
      const box = SecretBox.fromEnv({ CHANNEL_SECRET_KEY_1: key });
      for (const [id, ws] of [
        [account, W1],
        [account2, W2],
      ] as const)
        await admin.query(
          `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, app_id, oa_secret_key_enc, status)
           VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', $5, $6, 'connected')`,
          [
            id,
            org,
            ws,
            `oa-${id}`,
            appId,
            box.encrypt(oaSecret, { rowId: id, column: 'oa_secret_key_enc' }, 1),
          ],
        );
      const hashed = await hash(PW);
      for (const [name, ws] of [
        ['a', W1],
        ['b', W2],
      ] as const) {
        const id = (people[name] = uuidv7());
        await admin.query(
          `INSERT INTO users (id, email, status, email_verified_at, display_name) VALUES ($1, $2, 'active', now(), 'T')`,
          [id, `${id}@example.test`],
        );
        await admin.query(
          `INSERT INTO accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2, $3, 'credential', $4)`,
          [uuidv7(), id, id, hashed],
        );
        await admin.query(
          `INSERT INTO org_members (id, org_id, user_id, role, status) VALUES ($1, $2, $3, 'manager', 'active')`,
          [uuidv7(), org, id],
        );
        await admin.query(
          `INSERT INTO workspace_members (id, org_id, workspace_id, user_id) VALUES ($1, $2, $3, $4)`,
          [uuidv7(), org, ws, id],
        );
      }

      api = await spawnApi(key);
      const { url } = api;
      spawnWorker(
        'dist/main.js',
        workerEnv({
          EVENTS_CONSUMER_ENABLED: '1',
          EVENTS_DISCOVERY_MS: '200',
          EVENTS_MAX_QUEUES: '10000',
          INBOUND_POLL_MS: '100',
        }),
      );
      const got: Record<string, Packet[]> = { a: [], b: [] };
      for (const name of ['a', 'b']) {
        const res = await fetch(`${url}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: API_ORIGIN,
            'x-forwarded-for': [...randomBytes(4)].join('.'),
          },
          body: JSON.stringify({ email: `${people[name]}@example.test`, password: PW }),
        });
        expect(res.status).toBe(200);
        const cookie = res.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; ');
        const socket = io(`${url}/agent`, {
          transports: ['websocket'],
          extraHeaders: { origin: API_ORIGIN, cookie },
          reconnection: false,
          forceNew: true,
        });
        sockets.push(socket);
        socket.on('message.created', (packet: Packet) => got[name]?.push(packet));
        await new Promise<void>((done, fail) => {
          socket.once('connect', done);
          socket.once('connect_error', fail);
        });
      }
      const webhook = async (text: string, channel = account) => {
        const timestamp = String(Date.now());
        const msgId = `m-${uuidv7()}`;
        const raw = Buffer.from(
          JSON.stringify({
            app_id: appId,
            event_name: 'user_send_text',
            timestamp,
            sender: { id: `${org}-customer` },
            message: { msg_id: msgId, text },
          }),
        );
        const res = await fetch(`${url}/v1/hooks/zalo/${channel}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-zevent-signature': zaloSignature(raw, timestamp, { appId, oaSecretKey: oaSecret }),
          },
          body: raw,
        });
        expect(res.status).toBe(200);
      };

      // 1. The first message: its workspace learns of it, without the content.
      await webhook('xin chào 1');
      const [first] = await waitFor(() => Promise.resolve(got['a']?.length ? got['a'] : false), {
        timeoutMs: 45_000,
        label: `agent A to get the summary of the first message\n--- API ---\n${api.tail()}`,
      });
      expect(first).toMatchObject({
        type: 'message.created',
        aggregateVersion: null,
        data: { sequenceNumber: 1, senderKind: 'customer' },
      });
      expect(first?.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(first?.data).not.toHaveProperty('body');
      const conversationId = String(first?.data['conversationId']);

      // 2. A follows the conversation; the second message reaches it whole in the room of the conversation.
      const [a] = sockets as [Socket];
      expect(
        await a.timeout(10_000).emitWithAck('conversation.subscribe', { conversationId }),
      ).toEqual({ ok: true });
      await webhook('xin chào 2');
      const whole = await waitFor(() => Promise.resolve(got['a']?.find((p) => 'body' in p.data)), {
        timeoutMs: 30_000,
        label: 'agent A to get the second message whole',
      });
      expect(whole.data).toMatchObject({
        conversationId,
        sequenceNumber: 2,
        body: 'xin chào 2',
        kind: 'text',
      });
      await waitFor(() => Promise.resolve((got['a']?.length ?? 0) >= 3), {
        timeoutMs: 10_000,
        label: 'the summary of the second message',
      });
      expect(
        got['a']?.filter((p) => !('body' in p.data)).map((p) => p.data['sequenceNumber']),
      ).toEqual([1, 2]);

      // 3. B (W2, same organisation) gets nothing of W1. The mark: a message to W2, sent after everything of W1 was published. The
      // adapter of the API reads Valkey on one connection, in order, so a packet of W1 meant for B would have come before it.
      await webhook('xin chào W2', account2);
      await waitFor(() => Promise.resolve((got['b']?.length ?? 0) >= 1), {
        timeoutMs: 30_000,
        label: 'agent B to get the summary of W2',
      });
      expect(got['b']?.map((p) => p.data['conversationId'])).not.toContain(conversationId);
      expect(got['b']?.every((p) => !('body' in p.data))).toBe(true);
      expect(
        got['a']?.map((p) => p.data['conversationId']).every((id) => id === conversationId),
      ).toBe(true);
    } finally {
      for (const socket of sockets) socket.disconnect();
      await api?.stop();
      const users = Object.values(people);
      for (const table of ['sessions', 'workspace_members', 'org_members', 'accounts'])
        await admin
          .query(`DELETE FROM ${table} WHERE user_id = ANY($1::uuid[])`, [users])
          .catch(() => undefined);
      await removeInbound(admin, org);
      await admin
        .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users])
        .catch(() => undefined);
    }
  }, 180_000);
});
