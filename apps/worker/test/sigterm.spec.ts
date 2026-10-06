import { describe, expect, it } from 'vitest';

import { attemptsOf, statusCounts, writeEvents } from './db.js';
import { spawnWorker, valkey, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// The worker stopped by a signal (it could not be tried on Windows, O-4c-2): one SIGTERM stops it cleanly, a second one does not wait.
const suite = useQueueSuite();

describe('SIGTERM', () => {
  it('S1: one SIGTERM in the middle of the work: exit 0, nothing left claimed', async ({
    annotate,
  }) => {
    const org = await suite.newOrg();
    const written = await writeEvents(suite.app, org, 1000);
    // Batches of 5: 200 passes, so that the work is certainly in the middle when the signal comes.
    const worker = spawnWorker('dist/main.js', workerEnv({ OUTBOX_BATCH: '5' }));
    const atSignal = await waitFor(
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
    const signalled = performance.now();
    worker.signal('SIGTERM');
    expect(await worker.waitExit(12_000)).toEqual({ code: 0, signal: null });
    // Numbers for the next reader, not assertions: a pass with Valkey up is a few milliseconds, so the work in flight at the signal is
    // small and this case cannot tell a shutdown that waits for it from one that does not (S3 can).
    await annotate(
      `claimed when the signal was sent ${atSignal.claimed}, published ${atSignal.published}, pending ${atSignal.pending}; exit ${Math.round(performance.now() - signalled)} ms after the signal`,
    );
    expect(worker.logs('worker_stopping')).toHaveLength(1);
    // What the relay held when the signal came was finished or given back: no event is left claimed, none was lost on the way.
    const counts = await statusCounts(suite.admin, org);
    expect(counts.claimed).toBe(0);
    expect(counts.dead_letter).toBe(0);
    expect(counts.published + counts.pending).toBe(written.length);
  });

  // S1 cannot tell a shutdown that waits for the pass in progress from one that does not: with Valkey up a pass lasts a few milliseconds
  // and is usually over before the queue and the pool are closed (mutation M4 left it green). Here the pass is held open for up to 5 s.
  it('S3: one SIGTERM while a pass is blocked: it waits for the pass, gives the events back, exit 0', async () => {
    const org = await suite.newOrg();
    await writeEvents(suite.app, org, 20);
    await valkey('stop');
    // The longest a pass can be blocked (the wait for a connection) is 5 s, as long as the default wait of the shutdown: with 20 s the
    // shutdown has room, so that the result does not depend on which of the two ends first.
    const worker = spawnWorker('dist/main.js', workerEnv({ OUTBOX_SHUTDOWN_MS: '20000' }));
    await waitFor(async () => (await statusCounts(suite.admin, org)).claimed > 0, {
      timeoutMs: 20_000,
      everyMs: 20,
      label: 'the relay to hold a claim while Valkey is down',
    });
    worker.signal('SIGTERM');
    expect(await worker.waitExit(15_000)).toEqual({ code: 0, signal: null });
    expect(worker.logs('worker_stopping')).toHaveLength(1);
    // The pass ended through its failure path while the process was still alive: a shutdown that did not wait would have exited first.
    const failed = worker.logs('publish_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ orgId: org, count: 20, code: 'E_QUEUE_DOWN' });
    // The events the pass held went back to pending with the attempt counted: none is left claimed.
    expect(await statusCounts(suite.admin, org)).toEqual({
      pending: 20,
      claimed: 0,
      published: 0,
      dead_letter: 0,
    });
    expect(await attemptsOf(suite.admin, org, 'pending')).toEqual({ min: 1, max: 1 });
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
