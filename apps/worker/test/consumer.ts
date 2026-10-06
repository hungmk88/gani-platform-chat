import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

/** What the consumer of a queue was given: how many times for each event id (the `jobId`). */
export interface Consumer {
  readonly received: ReadonlyMap<string, number>;
  close(): Promise<void>;
}

/** A BullMQ consumer of one queue, standing in for the real ones (Socket.IO emitter and others) that come after the outbox. */
export async function startConsumer(redisUrl: string, queueName: string): Promise<Consumer> {
  const received = new Map<string, number>();
  // `maxRetriesPerRequest: null` is what BullMQ asks of a connection a Worker uses.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', () => undefined);
  const worker = new Worker(
    queueName,
    (job) => {
      received.set(job.id ?? '', (received.get(job.id ?? '') ?? 0) + 1);
      return Promise.resolve();
    },
    { connection },
  );
  worker.on('error', () => undefined);
  await worker.waitUntilReady();
  return {
    received,
    close: async () => {
      await worker.close().catch(() => undefined);
      connection.disconnect();
    },
  };
}

/** Every job the queue holds, in any state (waiting, active, completed, failed, ...): a job added twice would show as two. */
export async function totalJobs(redisUrl: string, queueName: string): Promise<number> {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  connection.on('error', () => undefined);
  const queue = new Queue(queueName, { connection });
  try {
    const counts = await queue.getJobCounts();
    return Object.values(counts).reduce((sum, n) => sum + n, 0);
  } finally {
    await queue.close().catch(() => undefined);
    connection.disconnect();
  }
}
