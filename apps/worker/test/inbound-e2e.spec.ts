import { describe, expect, it } from 'vitest';

import { spawnWorker, waitFor, workerEnv, type WorkerProcess } from './harness.js';
import { arrive, countOf, inboundStatuses, removeInbound, seedSpaces } from './inbound.js';
import { describeJobs } from './jobs.js';
import { startProducer } from './producer.js';
import { useQueueSuite } from './suite.js';

// The chain inside the worker (V6): an event stored by the webhook → the inbound processor (message + outbox, one transaction) → the
// relay → the queue of its workspace → the event consumer. The webhook itself is tested in the API (V4), the socket in V8.
const suite = useQueueSuite();

// The consumer on, and every queue of the shared registry taken (other tests leave theirs), with short waits.
const env = (): Record<string, string> =>
  workerEnv({
    EVENTS_CONSUMER_ENABLED: '1',
    EVENTS_DISCOVERY_MS: '200',
    EVENTS_MAX_QUEUES: '10000',
    INBOUND_POLL_MS: '100',
    INBOUND_LEASE_S: '5',
  });

/** The events the consumer handled, by id, from the logs of every worker given (a killed one included). */
const consumedBy = (...workers: WorkerProcess[]): Map<string, unknown> =>
  new Map(workers.flatMap((w) => w.logs('event_consumed')).map((l) => [String(l['eventId']), l]));

const outboxIds = async (org: string, type: string): Promise<string[]> =>
  (
    await suite.admin.query<{ id: string }>(
      'SELECT id FROM outbox_events WHERE org_id = $1 AND event_type = $2',
      [org, type],
    )
  ).rows.map((r) => r.id);

describe('webhook event to the consumer', () => {
  it('brings the events of the new messages to the consumer, each in its tenant', async () => {
    const { admin, app } = suite;
    const org = await suite.newOrg();
    try {
      const [first, second] = await seedSpaces(admin, org, 2);
      if (!first || !second) throw new Error('the workspaces were not made');
      await arrive(app, org, first, 'a');
      await arrive(app, org, first, 'b');
      await arrive(app, org, second, 'c');
      const worker = spawnWorker('dist/main.js', env());
      await waitFor(async () => (await outboxIds(org, 'message.created')).length === 3, {
        timeoutMs: 30_000,
        label: 'the three messages to be stored',
      });
      const expected = [
        ...(await outboxIds(org, 'message.created')),
        ...(await outboxIds(org, 'conversation.created')),
      ];
      expect(expected).toHaveLength(6);
      const consumed = await waitFor(
        () => {
          const seen = consumedBy(worker);
          return Promise.resolve(expected.every((id) => seen.has(id)) && seen);
        },
        { timeoutMs: 30_000, label: 'the consumer to handle the six events' },
      );
      const lines = expected.map((id) => consumed.get(id) as Record<string, unknown>);
      expect(new Set(lines.map((l) => l['orgId']))).toEqual(new Set([org]));
      expect(new Set(lines.map((l) => l['workspaceId']))).toEqual(new Set([first.ws, second.ws]));
    } finally {
      await removeInbound(admin, org);
    }
  });

  // Brief :875 and worker/CLAUDE.md: the worker killed while it takes in 50 messages a second loses none and stores none twice.
  it('K-IN: 50 messages a second, kill -9 in the middle: no message lost, none twice, and every one reaches the consumer', async ({
    annotate,
  }) => {
    const { admin, app } = suite;
    const org = await suite.newOrg();
    try {
      const spaces = await seedSpaces(admin, org, 2);
      let n = 0;
      const producer = startProducer(async () => {
        for (let i = 0; i < 5; i++, n++)
          await arrive(app, org, spaces[n % 2] as (typeof spaces)[number], `p${n % 10}`);
      }, 100);
      const first = spawnWorker('dist/main.js', env());
      const count = (sql: string) => countOf(admin, org, sql);
      await waitFor(async () => ((await inboundStatuses(admin, org))['processed'] ?? 0) >= 100, {
        timeoutMs: 25_000,
        label: 'the worker to process 100 events while the producer writes',
      });
      // Killed the moment a claim is seen: the kill must fall in the middle of a batch, not between two passes.
      await waitFor(async () => ((await inboundStatuses(admin, org))['claimed'] ?? 0) > 0, {
        timeoutMs: 30_000,
        everyMs: 10,
        label: 'the processor to hold a claim',
      });
      const killedAt = new Date().toISOString();
      first.signal('SIGKILL');
      expect((await first.waitExit(10_000)).signal).toBe('SIGKILL');
      const atKill = n;
      await waitFor(() => Promise.resolve(n >= atKill + 150), {
        timeoutMs: 20_000,
        label: 'the producer to write 150 events while the worker is dead',
      });
      const restartedAt = new Date().toISOString();
      const second = spawnWorker('dist/main.js', env());
      await waitFor(() => Promise.resolve(n >= 1000), {
        timeoutMs: 40_000,
        everyMs: 250,
        label: 'the producer to write 1000 events',
      });
      await producer.stop();

      await waitFor(
        async () => {
          const { pending = 0, claimed = 0 } = await inboundStatuses(admin, org);
          return pending + claimed === 0;
        },
        { timeoutMs: 45_000, label: 'every inbound event to be processed after the restart' },
      );
      const written = await count(
        'SELECT count(*)::int AS n FROM inbound_events WHERE org_id = $1',
      );
      expect(await inboundStatuses(admin, org)).toEqual({ processed: written });
      expect(await count('SELECT count(*)::int AS n FROM messages WHERE org_id = $1')).toBe(
        written,
      );
      expect(
        await count(
          'SELECT count(DISTINCT platform_message_id)::int AS n FROM messages WHERE org_id = $1',
        ),
      ).toBe(written);
      // A job the killed worker was running comes back to the second one after two stalled checks of BullMQ (30 s apart: the first
      // marks it, the next moves it once its lock is gone): about 65 s after the kill, measured locally (#324).
      const created = await outboxIds(org, 'message.created');
      expect(created).toHaveLength(written);
      const waitedFrom = new Date().toISOString();
      await waitFor(
        () => {
          const seen = consumedBy(first, second);
          return Promise.resolve(created.every((id) => seen.has(id)));
        },
        { timeoutMs: 75_000, label: 'the consumer to handle every message.created' },
      ).catch(async (error: unknown) => {
        // Where the events the consumer never logged are (#324): their jobs in BullMQ, and what the workers said of them.
        const seen = consumedBy(first, second);
        const missing = created.filter((id) => !seen.has(id));
        const { rows } = await admin.query<{ id: string; ws: string }>(
          'SELECT id, workspace_id AS ws FROM outbox_events WHERE id = ANY($1::uuid[])',
          [missing],
        );
        const queues = [...new Set(rows.map((r) => r.ws))];
        const jobs = await Promise.all(
          queues.map((ws) =>
            describeJobs(
              suite.redisUrl,
              `q.events.ws.${ws}`,
              rows.filter((r) => r.ws === ws).map((r) => r.id),
            ),
          ),
        );
        const said = [first, second].map((w, i) =>
          ['event_job_stalled', 'event_job_failed', 'event_handler_failed', 'event_message_missing']
            .flatMap((m) => w.logs(m))
            .map((l) => `  worker ${i + 1}: ${JSON.stringify(l)}`)
            .join('\n'),
        );
        // prettier-ignore
        throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- K-IN: killed ${killedAt}, restarted ${restartedAt}, waited from ${waitedFrom}; ${missing.length} of ${created.length} message.created never consumed ---\n${jobs.join('\n')}\n${said.join('\n')}`, { cause: error });
      });
      // How long the jobs the killed worker held took to come back (BullMQ's stalled check), against the 75 s of the wait.
      const since = (at: unknown) =>
        ((Date.parse(String(at)) - Date.parse(killedAt)) / 1000).toFixed(1);
      const stalled = second.logs('event_job_stalled').map((l) => since(l['time']));
      await annotate(
        `jobs taken back from the killed worker ${stalled.length} (s after the kill: ${stalled.join(', ') || '-'}), all consumed ${since(new Date().toISOString())} s after the kill`,
      );
    } finally {
      await removeInbound(admin, org);
    }
  }, 240_000);
});
