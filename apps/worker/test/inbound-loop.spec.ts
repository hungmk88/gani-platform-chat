import { describe, expect, it } from 'vitest';

import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { arrive, countOf, inboundStatuses, removeInbound, seedSpaces } from './inbound.js';
import { useQueueSuite } from './suite.js';

// The real worker (dist/main.js) processing stored webhooks (inbound spec §2–3): what the webhook stored in two workspaces becomes
// messages, a follow is ignored, nothing is left pending or claimed, and a SIGTERM stops it cleanly with the processor running.
const suite = useQueueSuite();

describe('the inbound processor of the worker', () => {
  it('turns the events of two workspaces into messages, ignores a follow, and stops cleanly', async () => {
    const { admin, app } = suite;
    const org = await suite.newOrg();
    try {
      const [first, second] = await seedSpaces(admin, org, 2);
      if (!first || !second) throw new Error('the workspaces were not made');
      // 12 messages of 3 people in the first workspace, 2 of one person in the second, and a follow.
      for (let i = 0; i < 12; i++) await arrive(app, org, first, `p${i % 3}`);
      for (let i = 0; i < 2; i++) await arrive(app, org, second, 'q');
      await arrive(app, org, second, 'q', 'follow');
      const worker = spawnWorker(
        'dist/main.js',
        workerEnv({ INBOUND_POLL_MS: '100', INBOUND_BATCH: '5' }),
      );
      await waitFor(
        async () => {
          const { pending = 0, claimed = 0 } = await inboundStatuses(admin, org);
          return pending + claimed === 0;
        },
        { timeoutMs: 30_000, label: 'every inbound event to be processed or ignored' },
      );
      expect(await inboundStatuses(admin, org)).toEqual({ ignored: 1, processed: 14 });
      const count = (sql: string) => countOf(admin, org, sql);
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
      await removeInbound(admin, org);
    }
  });
});
