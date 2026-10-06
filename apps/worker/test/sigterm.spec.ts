import { describe, expect, it } from 'vitest';

import { statusCounts, writeEvents } from './db.js';
import { spawnWorker, valkey, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// The worker stopped by a signal (it could not be tried on Windows, O-4c-2): one SIGTERM stops it cleanly, a second one does not wait.
const suite = useQueueSuite();

describe('SIGTERM', () => {
  it('S1: one SIGTERM in the middle of the work: exit 0, nothing left claimed', async () => {
    const org = await suite.newOrg();
    const written = await writeEvents(suite.app, org, 1000);
    // Batches of 5: 200 passes, so that the work is certainly in the middle when the signal comes.
    const worker = spawnWorker('dist/main.js', workerEnv({ OUTBOX_BATCH: '5' }));
    await waitFor(
      async () => {
        const counts = await statusCounts(suite.admin, org);
        return counts.published >= 1 && counts.pending > 0 ? counts : false;
      },
      {
        timeoutMs: 30_000,
        everyMs: 20,
        label:
          'the relay to be in the middle of the 1000 events (if all were published already, it was too fast for the signal)',
      },
    );
    worker.signal('SIGTERM');
    expect(await worker.waitExit(12_000)).toEqual({ code: 0, signal: null });
    expect(worker.logs('worker_stopping')).toHaveLength(1);
    // What the relay held when the signal came was finished or given back: no event is left claimed, none was lost on the way.
    const counts = await statusCounts(suite.admin, org);
    expect(counts.claimed).toBe(0);
    expect(counts.dead_letter).toBe(0);
    expect(counts.published + counts.pending).toBe(written.length);
  });

  it('S2: a second SIGTERM while the first is being served: exit 1 at once', async () => {
    const org = await suite.newOrg();
    await writeEvents(suite.app, org, 20);
    // With Valkey down the first pass claims the events and waits up to 5 s for a connection: the shutdown of the first signal has to wait
    // for that pass, and the second signal comes while it does.
    await valkey('stop');
    const worker = spawnWorker('dist/main.js', workerEnv());
    await waitFor(async () => (await statusCounts(suite.admin, org)).claimed > 0, {
      timeoutMs: 20_000,
      everyMs: 20,
      label: 'the relay to hold a claim while Valkey is down',
    });
    worker.signal('SIGTERM');
    await worker.waitLog('worker_stopping', { timeoutMs: 5_000 });
    worker.signal('SIGTERM');
    expect(await worker.waitExit(3_000)).toEqual({ code: 1, signal: null });
    expect(worker.logs('worker_stopping')).toHaveLength(1);
  });
});
