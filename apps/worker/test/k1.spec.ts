import { describe, expect, it } from 'vitest';

import { attemptsOf, publishedAmong, statusCounts, writeEvents } from './db.js';
import { spawnWorker, valkey, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// K1 (outbox spec §10): Valkey is stopped while the relay has events to send. The events wait in the outbox with their attempts
// counted, none is marked published, and when Valkey is back all of them are delivered. The worker is a real process.
const suite = useQueueSuite();

describe('K1: Valkey stopped', () => {
  it('K1a: events written, Valkey stopped before the worker starts: they wait, then all are delivered', async () => {
    const org = await suite.newOrg();
    const ids = await writeEvents(suite.app, org, 100);
    await valkey('stop');
    const worker = spawnWorker('dist/main.js', workerEnv());

    // The first pass cannot reach the queue: the publisher waits up to 5 s for a connection, then the batch goes back with a backoff.
    const failure = await worker.waitLog('publish_failed', {
      timeoutMs: 30_000,
      where: (line) => line.orgId === org,
    });
    expect(failure).toMatchObject({ code: 'E_QUEUE_DOWN', count: 100 });
    expect(await statusCounts(suite.admin, org)).toEqual({
      pending: 100,
      claimed: 0,
      published: 0,
      dead_letter: 0,
    });
    expect(await attemptsOf(suite.admin, org, 'pending')).toEqual({ min: 1, max: 1 });

    await valkey('start');
    await waitFor(async () => (await statusCounts(suite.admin, org)).published === 100, {
      timeoutMs: 45_000,
      label: 'all 100 events to be published after Valkey is back',
    });
    expect(await statusCounts(suite.admin, org)).toMatchObject({ dead_letter: 0, pending: 0 });

    const consumer = await suite.consume(org);
    await waitFor(() => Promise.resolve(consumer.received.size === 100), {
      timeoutMs: 20_000,
      label: 'the consumer to receive the 100 events',
    });
    expect(ids.filter((id) => !consumer.received.has(id))).toEqual([]);
  });

  it('K1b: Valkey stopped while the worker is sending, events written meanwhile: they wait, then all 200 are delivered', async () => {
    const org = await suite.newOrg();
    const first = await writeEvents(suite.app, org, 100);
    const worker = spawnWorker('dist/main.js', workerEnv());
    await waitFor(async () => (await statusCounts(suite.admin, org)).published >= 20, {
      timeoutMs: 30_000,
      label: 'the worker to publish the first events',
    });

    // The queue is up: the relay has not failed on the organisation yet.
    expect(worker.logs('queue_unreachable')).toEqual([]);
    await valkey('stop');
    const second = await writeEvents(suite.app, org, 100);
    // The relay now knows the queue of the organisation, so the first thing it does in a pass is to ask the queue how full it is
    // (backpressure). With Valkey down that question fails before anything is claimed: the organisation is skipped and a warning
    // `queue_unreachable` is logged, the events stay pending and no attempt is used (unlike K1a, where the relay knows no queue yet).
    // Outbox spec §10 K1 as adjusted in N99.
    const unreachable = await worker.waitLog('queue_unreachable', {
      timeoutMs: 20_000,
      where: (line) => line.orgId === org,
    });
    expect(unreachable).toMatchObject({ level: 'warn', code: 'E_QUEUE_DOWN' });
    expect(await publishedAmong(suite.admin, org, second)).toBe(0);
    const during = await statusCounts(suite.admin, org);
    expect(during.dead_letter).toBe(0);
    expect(during.published).toBeLessThan(200);
    expect(during.published + during.pending + during.claimed).toBe(200);

    await valkey('start');
    await waitFor(async () => (await statusCounts(suite.admin, org)).published === 200, {
      timeoutMs: 45_000,
      label: 'all 200 events to be published after Valkey is back',
    });
    expect(await statusCounts(suite.admin, org)).toMatchObject({ dead_letter: 0, pending: 0 });

    const consumer = await suite.consume(org);
    await waitFor(() => Promise.resolve(consumer.received.size === 200), {
      timeoutMs: 20_000,
      label: 'the consumer to receive the 200 events',
    });
    expect([...first, ...second].filter((id) => !consumer.received.has(id))).toEqual([]);
  });
});
