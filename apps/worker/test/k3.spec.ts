import { describe, expect, it } from 'vitest';

import { idsOf, statusCounts, writeEvents } from './db.js';
import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { startProducer } from './producer.js';
import { useQueueSuite } from './suite.js';

// K3 (outbox spec §10): 50 events a second for 60 seconds, the worker is killed with SIGKILL in the middle and started again. Nothing may
// be lost: what the consumer received contains everything that was written, and nothing went to dead_letter.
// The case is statistical: where the kill falls in a pass is not decided by the test, only that a pass was holding a claim. The exact
// points (after and before the publish) are K2. What K3 shows is that the invariant holds under load.
const suite = useQueueSuite();
const RUN_MS = 60_000;

describe('K3: 50 events a second, kill -9 in the middle', () => {
  it('loses no event and dead-letters none', async ({ annotate }) => {
    const org = await suite.newOrg();
    const consumer = await suite.consume(org);
    const first = spawnWorker('dist/main.js', workerEnv());
    const started = performance.now();
    const producer = startProducer(() => writeEvents(suite.app, org, 5), 100);

    await waitFor(async () => (await statusCounts(suite.admin, org)).published >= 500, {
      timeoutMs: 25_000,
      label: 'the worker to publish 500 events while the producer writes',
    });
    // The relay rests 100 ms between two passes, so a kill at a random moment rarely meets one that holds a claim. Look at the table
    // every 10 ms and kill the moment a claim is seen. If none is ever seen the case fails: it is not allowed to pass without a kill
    // in the middle of a pass (a claim can be held for less than the 10 ms of a look).
    const claimedAtKill = await waitFor(
      async () => {
        const { claimed } = await statusCounts(suite.admin, org);
        return claimed > 0 ? claimed : false;
      },
      {
        timeoutMs: 30_000,
        everyMs: 10,
        label:
          'the relay to hold a claim (no pass in progress was seen in 30 s, so the kill would not have met one)',
      },
    );
    first.signal('SIGKILL');
    expect((await first.waitExit(10_000)).signal).toBe('SIGKILL');

    // The producer goes on writing while no worker runs: 3 seconds of it, counted in events (150) and not in time.
    const total = async (): Promise<number> => {
      const counts = await statusCounts(suite.admin, org);
      return counts.pending + counts.claimed + counts.published + counts.dead_letter;
    };
    const atKill = await total();
    await waitFor(async () => (await total()) >= atKill + 150, {
      timeoutMs: 20_000,
      label: 'the producer to write 150 events while the worker is dead',
    });
    spawnWorker('dist/main.js', workerEnv());

    await waitFor(() => Promise.resolve(performance.now() - started >= RUN_MS), {
      timeoutMs: RUN_MS + 5_000,
      everyMs: 250,
      label: 'the 60 seconds of the producer to pass',
    });
    // `stop()` returns when no write is in flight: only now is the set of what was written complete, and read from the table.
    await producer.stop();
    const written = await idsOf(suite.admin, org);
    expect(written.length).toBeGreaterThanOrEqual(atKill + 150);

    await waitFor(
      async () => {
        const counts = await statusCounts(suite.admin, org);
        return counts.pending + counts.claimed === 0 ? counts : false;
      },
      { timeoutMs: 45_000, label: 'the outbox to be drained after the restart' },
    );
    await waitFor(() => Promise.resolve(written.every((id) => consumer.received.has(id))), {
      timeoutMs: 30_000,
      label: 'the consumer to have received every event written',
    });

    const counts = await statusCounts(suite.admin, org);
    const duplicates = [...consumer.received.values()].filter((n) => n > 1).length;
    await annotate(
      `written ${written.length}, claimed when killed ${claimedAtKill}, events received more than once ${duplicates}`,
    );
    expect(counts.dead_letter).toBe(0);
    expect(counts.published).toBe(written.length);
    expect(written.filter((id) => !consumer.received.has(id))).toEqual([]);
  }, 180_000);
});
