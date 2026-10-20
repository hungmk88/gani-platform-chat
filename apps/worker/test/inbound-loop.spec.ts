import { insertIfAbsent, withTenant } from '@gani/db';
import { uuidv7 } from '@gani/domain';
import { describe, expect, it } from 'vitest';

import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// The real worker (dist/main.js) processing stored webhooks (inbound spec §2–3): what the webhook stored in two workspaces becomes
// messages, a follow is ignored, nothing is left pending or claimed, and a SIGTERM stops it cleanly with the processor running.
const suite = useQueueSuite();

const TABLES = [
  'outbox_events',
  'conversation_events',
  'messages',
  'conversations',
  'inbound_events',
  'inbound_event_keys',
  'channel_accounts',
  'workspaces',
];

describe('the inbound processor of the worker', () => {
  it('turns the events of two workspaces into messages, ignores a follow, and stops cleanly', async () => {
    const { admin, app } = suite;
    const org = await suite.newOrg();
    const spaces = [uuidv7(), uuidv7()].map((ws) => ({ ws, account: uuidv7() }));
    try {
      for (const { ws, account } of spaces) {
        await admin.query(
          `INSERT INTO workspaces (id, org_id, slug, name, template) VALUES ($1, $2, $3, 'W', 'service')`,
          [ws, org, `w-${ws}`],
        );
        await admin.query(
          `INSERT INTO channel_accounts (id, org_id, workspace_id, type, external_account_id, display_name, status)
           VALUES ($1, $2, $3, 'zalo_oa', $4, 'OA', 'connected')`,
          [account, org, ws, `oa-${account}`],
        );
      }
      // 12 messages of 3 people in the first workspace, 2 of one person in the second, and a follow.
      const arrivals = [
        ...Array.from({ length: 12 }, (_, i) => ({
          space: 0,
          person: `p${i % 3}`,
          name: 'user_send_text',
        })),
        ...Array.from({ length: 2 }, () => ({ space: 1, person: 'q', name: 'user_send_text' })),
        { space: 1, person: 'q', name: 'follow' },
      ];
      for (const { space, person, name } of arrivals) {
        const { ws, account } = spaces[space] as { ws: string; account: string };
        const msgId = `m-${uuidv7()}`;
        await withTenant(app, { orgId: org, workspaceIds: [ws] }, (tx) =>
          insertIfAbsent(tx, {
            id: uuidv7(),
            workspaceId: ws,
            channelAccountId: account,
            platformMessageId: msgId,
            eventType: name,
            payload: {
              event_name: name,
              timestamp: String(Date.now()),
              sender: { id: `${org}-${person}` },
              message: { msg_id: msgId, text: 'xin chào' },
            },
          }),
        );
      }
      const worker = spawnWorker(
        'dist/main.js',
        workerEnv({ INBOUND_POLL_MS: '100', INBOUND_BATCH: '5' }),
      );
      const statuses = () =>
        admin
          .query<{ status: string; n: number }>(
            'SELECT status, count(*)::int AS n FROM inbound_events WHERE org_id = $1 GROUP BY status ORDER BY status',
            [org],
          )
          .then((r) => r.rows);
      await waitFor(
        async () => {
          const rows = await statuses();
          return rows.every((r) => r.status === 'processed' || r.status === 'ignored') && rows;
        },
        { timeoutMs: 30_000, label: 'every inbound event to be processed or ignored' },
      );
      expect(await statuses()).toEqual([
        { status: 'ignored', n: 1 },
        { status: 'processed', n: 14 },
      ]);
      const count = async (sql: string) =>
        ((await admin.query<{ n: number }>(sql, [org])).rows[0] as { n: number }).n;
      expect(await count('SELECT count(*)::int AS n FROM conversations WHERE org_id = $1')).toBe(4);
      expect(await count('SELECT count(*)::int AS n FROM messages WHERE org_id = $1')).toBe(14);
      expect(
        await count(
          "SELECT count(*)::int AS n FROM outbox_events WHERE org_id = $1 AND event_type = 'message.created'",
        ),
      ).toBe(14);
      worker.signal('SIGTERM');
      expect(await worker.waitExit(12_000)).toEqual({ code: 0, signal: null });
    } finally {
      for (const table of TABLES)
        await admin.query(`DELETE FROM ${table} WHERE org_id = $1`, [org]).catch(() => undefined);
    }
  });
});
