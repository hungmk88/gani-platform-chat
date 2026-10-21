import { uuidv7 } from '@gani/domain';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { EventConsumer } from '../src/consumer/event-consumer.js';
import {
  createBullmqPublisher,
  EVENT_QUEUE_REGISTRY,
  type BullmqPublisher,
} from '../src/queue/bullmq-publisher.js';
import { createBullmqSource, type BullmqSource } from '../src/queue/bullmq-source.js';
import type { EventJob } from '../src/relay/job.js';
import { requireEnv, waitFor } from './harness.js';

// The consumer over the real BullMQ and Valkey (N141): it finds a queue through the registry the publisher writes, runs a job in the
// tenant of the event, and fails a job without a tenant at once, without the five attempts of an ordinary failure.
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
let redisUrl = '';
let probe: Redis | undefined;
const connection = (): Redis => {
  if (!probe) throw new Error('the connection to Valkey was not made: see the error of beforeAll');
  return probe;
};
const opened: { close(): Promise<unknown> }[] = [];
const track = <T extends { close(): Promise<unknown> }>(thing: T): T => {
  opened.push(thing);
  return thing;
};

const job = (queue: string, orgId: unknown, workspaceId: string): EventJob =>
  ({
    queue,
    jobId: uuidv7(),
    data: { id: uuidv7(), type: 'message.created', version: 1, orgId, workspaceId, payload: {} },
  }) as unknown as EventJob;

beforeAll(() => {
  redisUrl = requireEnv('REDIS_URL');
  requireEnv('VALKEY_CONTAINER');
  probe = new Redis(redisUrl, { maxRetriesPerRequest: null });
  probe.on('error', () => undefined);
});

afterEach(async () => {
  for (const thing of opened.splice(0).reverse()) await thing.close().catch(() => undefined);
});

afterAll(async () => {
  await probe?.quit().catch(() => undefined);
});

describe('the event consumer on a real Valkey', () => {
  it('finds the queue a publish registered, runs its job in the tenant, and fails a job without a tenant at once', async () => {
    const [org, ws] = [uuidv7(), uuidv7()];
    const queue = `q.events.ws.${ws}`;
    const publisher: BullmqPublisher = track(createBullmqPublisher(redisUrl, quiet));
    const good = job(queue, org, ws);
    const orphan = job(queue, undefined, ws);
    await publisher.publish([good, orphan]);
    expect(await connection().sismember(EVENT_QUEUE_REGISTRY, queue)).toBe(1);

    const tenants = new Map<string, unknown>();
    const source: BullmqSource = createBullmqSource(redisUrl, quiet, 2);
    // The registry is shared with every other test of this Valkey: only the queue of this test is taken.
    const consumer = new EventConsumer({
      source: {
        queues: async () => (await source.queues()).filter((name) => name === queue),
        subscribe: (name, handle) => source.subscribe(name, handle),
        close: () => source.close(),
      },
      handlers: {
        'message.created': (event, tenant) => {
          tenants.set(event.id, tenant);
          return Promise.resolve();
        },
      },
      log: quiet,
      settings: { discoveryMs: 100, maxQueues: 1 },
      shutdownMs: 10_000,
    });
    track({ close: () => consumer.stop() });
    consumer.start();

    await waitFor(() => Promise.resolve(tenants.has(good.data.id)), {
      timeoutMs: 20_000,
      label: 'the consumer to run the job with a tenant',
    });
    expect(tenants.get(good.data.id)).toEqual({ orgId: org, workspaceIds: [ws] });
    const bull = track(new Queue(queue, { connection: connection() }));
    const failed = await waitFor(
      async () => {
        const stored = await bull.getJob(orphan.jobId);
        return (await stored?.isFailed()) ? stored : false;
      },
      { timeoutMs: 20_000, label: 'the job without a tenant to fail' },
    );
    expect(failed.attemptsMade).toBe(1);
    expect(failed.failedReason).toBe('E_TENANT_MISSING');
    expect(tenants.has(orphan.data.id)).toBe(false);
  });
});
