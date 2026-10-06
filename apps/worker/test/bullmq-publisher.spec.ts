import { uuidv7 } from '@gani/domain';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createBullmqPublisher, type BullmqPublisher } from '../src/queue/bullmq-publisher.js';
import { errorCodeOf, type EventJob } from '../src/relay/job.js';
import { requireEnv, valkey, waitFor } from './harness.js';

// The BullmqPublisher against a real Valkey (O-5a): what the unit tests can only claim. The queue names are new for each test, so
// the tests do not see each other's jobs. The kill-tests (K1-K3) are O-5b.
const type = 'conversation.state_changed';

const queueName = (): string => `q.test.${uuidv7()}`;
const job = (queue: string, jobId = uuidv7()): EventJob => ({
  queue,
  jobId,
  data: {
    id: jobId,
    type,
    version: 1,
    orgId: uuidv7(),
    workspaceId: null,
    occurredAt: '2026-10-06T10:00:00.000Z',
    traceId: 'trace-test',
    actor: { kind: 'system', id: null },
    aggregate: { type: 'conversation', id: uuidv7(), version: 1 },
    payload: { to: 'HUMAN_ACTIVE' },
  },
});

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
let redisUrl: string;
let shared: Redis | undefined;
/** The connection of the tests; it exists once `beforeAll` has found the settings. */
function connection(): Redis {
  if (!shared) throw new Error('the connection to Valkey was not made: see the error of beforeAll');
  return shared;
}
const opened: { close(): Promise<unknown> }[] = [];

/** A publisher, a consumer or a queue the test opens is closed after it, whatever the result. */
function track<T extends { close(): Promise<unknown> }>(thing: T): T {
  opened.push(thing);
  return thing;
}
const publisherOf = (): BullmqPublisher => track(createBullmqPublisher(redisUrl, quiet));
const queueOf = (name: string): Queue => track(new Queue(name, { connection: connection() }));

/** A consumer of one queue that remembers what it was given, in order. */
async function consume(name: string): Promise<string[]> {
  const received: string[] = [];
  const worker = track(
    new Worker(
      name,
      (item) => {
        received.push(item.id ?? '');
        return Promise.resolve();
      },
      { connection: connection() },
    ),
  );
  await worker.waitUntilReady();
  return received;
}

beforeAll(() => {
  redisUrl = requireEnv('REDIS_URL');
  requireEnv('VALKEY_CONTAINER');
  // `maxRetriesPerRequest: null` is what BullMQ asks of a connection a Worker uses.
  shared = new Redis(redisUrl, { maxRetriesPerRequest: null });
  shared.on('error', () => undefined);
});

afterEach(async () => {
  // A test that stopped Valkey must not leave it stopped for the next one.
  await valkey('start').catch(() => undefined);
  await waitFor(async () => (await connection().ping()) === 'PONG', {
    timeoutMs: 60_000,
    label: 'Valkey to answer again',
  });
  for (const thing of opened.splice(0)) await thing.close().catch(() => undefined);
});

afterAll(async () => {
  await shared?.quit().catch(() => undefined);
});

describe('on a real Valkey', () => {
  it('gives a consumer the jobs the publisher added, with the event type as name', async () => {
    const name = queueName();
    const received = await consume(name);
    const jobs = [job(name), job(name), job(name)];
    await publisherOf().publish(jobs);
    await waitFor(() => Promise.resolve(received.length === 3), {
      timeoutMs: 20_000,
      label: 'the consumer to receive 3 jobs',
    });
    expect([...received].sort()).toEqual(jobs.map((j) => j.jobId).sort());
    const stored = await queueOf(name).getJob(jobs[0]?.jobId ?? '');
    expect(stored?.name).toBe(type);
    expect(stored?.opts).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    });
  });

  it('counts the waiting, the paused and the prioritized jobs, and not the delayed ones', async () => {
    const name = queueName();
    const queue = queueOf(name);
    await publisherOf().publish([job(name), job(name)]);
    await queue.add('x', {}, { priority: 5 });
    await queue.add('x', {}, { delay: 3_600_000 });
    await queue.pause();
    await queue.add('x', {});
    expect(await publisherOf().waiting(name)).toBe(4);
  });

  // The assumption of N98: BullMQ does not tell a job it already has from a new one, and does not throw.
  it('ignores a job id that is already in the queue, without an error and without a second job', async () => {
    const name = queueName();
    const queue = queueOf(name);
    const publisher = publisherOf();
    const [one, two] = [job(name), job(name)];
    expect(await publisher.publish([one])).toEqual({ duplicates: [] });
    expect(await publisher.publish([one])).toEqual({ duplicates: [] });
    await publisher.publish([two, two]);
    expect(await queue.getJobCountByTypes('waiting')).toBe(2);
  });

  it('still ignores a job id after the job has run, while the queue keeps the finished job', async () => {
    const name = queueName();
    const received = await consume(name);
    const publisher = publisherOf();
    const [first, again, sentinel] = [job(name), job(name), job(name)];
    await publisher.publish([first]);
    await waitFor(() => Promise.resolve(received.length === 1), {
      timeoutMs: 20_000,
      label: 'the first job to run',
    });
    // The sentinel comes after the duplicate in a queue of one consumer: when it has run, a second run of `first` would have too.
    await publisher.publish([first, again, sentinel]);
    await waitFor(() => Promise.resolve(received.includes(sentinel.jobId)), {
      timeoutMs: 20_000,
      label: 'the sentinel job to run',
    });
    expect(received.filter((id) => id === first.jobId)).toHaveLength(1);
    expect(received).toContain(again.jobId);
  });

  // Not a simulated outage: the container is stopped while the publisher holds a ready connection and a Queue (O-4c-1, risk b).
  it('fails fast with E_QUEUE_DOWN while Valkey is stopped, and works again when it is back', async () => {
    const name = queueName();
    const publisher = publisherOf();
    await publisher.publish([job(name)]);
    await valkey('stop');
    const failure = await waitFor(
      async () => {
        try {
          await publisher.publish([job(name)]);
          return false;
        } catch (error) {
          return { error };
        }
      },
      { timeoutMs: 30_000, label: 'a publish to fail while Valkey is stopped' },
    );
    expect(errorCodeOf(failure.error)).toBe('E_QUEUE_DOWN');
    await valkey('start');
    const after = job(name);
    await waitFor(
      async () => {
        await publisher.publish([after]);
        return true;
      },
      { timeoutMs: 60_000, label: 'a publish to work again after Valkey is back' },
    );
    expect(await queueOf(name).getJob(after.jobId)).toBeDefined();
  });
});
