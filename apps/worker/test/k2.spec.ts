import { describe, expect, it } from 'vitest';

import { totalJobs } from './consumer.js';
import { queueOf, statusCounts, writeEvents } from './db.js';
import { spawnWorker, waitFor, workerEnv } from './harness.js';
import { useQueueSuite } from './suite.js';

// K2 (outbox spec §10): the relay is killed in the middle of a pass. The crash entry (test/support/crash-main.mjs) kills itself at one
// exact point, so the case does not depend on timing. After the lease the next worker takes the events back and sends them again
// with the same jobId; the consumer must be given each event once.
const suite = useQueueSuite();
const EVENTS = 20;

async function crashAndRecover(crashAt: 'before_publish' | 'after_publish') {
  const org = await suite.newOrg();
  const ids = await writeEvents(suite.app, org, EVENTS);
  const consumer = await suite.consume(org);

  const crashing = spawnWorker('test/support/crash-main.mjs', workerEnv({ CRASH_AT: crashAt }));
  const ended = await crashing.waitExit(20_000);
  expect(ended.signal).toBe('SIGKILL');
  // The events are held by a relay that no longer exists: claimed, not published.
  expect(await statusCounts(suite.admin, org)).toEqual({
    pending: 0,
    claimed: EVENTS,
    published: 0,
    dead_letter: 0,
  });
  const inQueue = await totalJobs(suite.redisUrl, queueOf(org));

  const recovering = spawnWorker('dist/main.js', workerEnv());
  await waitFor(async () => (await statusCounts(suite.admin, org)).published === EVENTS, {
    timeoutMs: 45_000,
    label: `the ${EVENTS} events to be published after the lease`,
  });
  await waitFor(() => Promise.resolve(consumer.received.size === EVENTS), {
    timeoutMs: 20_000,
    label: `the consumer to receive the ${EVENTS} events`,
  });
  expect(recovering.logs('lease_lost')).toEqual([]);
  return { org, ids, consumer, inQueue };
}

describe('K2: the relay is killed in the middle of a pass', () => {
  it('K2a: after the events are in the queue and before they are marked: sent again, queued once, received once', async () => {
    const { org, ids, consumer, inQueue } = await crashAndRecover('after_publish');
    expect(inQueue).toBe(EVENTS);
    // The same jobId the second time: the queue holds each event once, and the consumer had it once.
    expect(await totalJobs(suite.redisUrl, queueOf(org))).toBe(EVENTS);
    expect(ids.map((id) => consumer.received.get(id))).toEqual(ids.map(() => 1));
    expect(await statusCounts(suite.admin, org)).toMatchObject({
      published: EVENTS,
      dead_letter: 0,
    });
  });

  it('K2b: after the events are claimed and before they are in the queue: nothing was queued, then all are, once', async () => {
    const { org, ids, consumer, inQueue } = await crashAndRecover('before_publish');
    expect(inQueue).toBe(0);
    expect(await totalJobs(suite.redisUrl, queueOf(org))).toBe(EVENTS);
    expect(ids.map((id) => consumer.received.get(id))).toEqual(ids.map(() => 1));
    expect(await statusCounts(suite.admin, org)).toMatchObject({
      published: EVENTS,
      dead_letter: 0,
    });
  });
});
