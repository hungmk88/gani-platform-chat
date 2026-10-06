// The only file of the worker that imports `bullmq` and `ioredis` (ESLint enforces it): the rest sees `QueuePublisher`.
import { Queue, type BulkJobOptions } from 'bullmq';
import { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import type { EventJob } from '../relay/job.js';
import type { QueuePublisher } from '../relay/outbox-relay.js';

/** How long one call to the queue may take, and how long to wait for a connection that is coming up (N98). */
export const QUEUE_CALL_MS = 5000;
const ERROR_LOG_EVERY_MS = 30_000;

/** The options of every job (outbox spec §5): the retention keeps a window to debug in, with a cap so a storm cannot fill the memory. */
export const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 10_000 },
  removeOnFail: { age: 604_800, count: 1000 },
} as const satisfies BulkJobOptions;

/** The queue did not answer in time or has no connection: the relay stores `E_QUEUE_DOWN` and retries after the backoff. */
export class QueueDownError extends Error {
  readonly code = 'E_QUEUE_DOWN';
}

/** The part of a BullMQ `Queue` the publisher uses. */
export interface JobQueue {
  addBulk(jobs: { name: string; data: unknown; opts: BulkJobOptions }[]): Promise<unknown>;
  getJobCountByTypes(...types: ('waiting' | 'prioritized')[]): Promise<number>;
  close(): Promise<void>;
}

/** The part of an ioredis connection the publisher uses. */
export interface Connection {
  readonly status: string;
  once(event: 'ready', listener: () => void): unknown;
  off(event: 'ready', listener: () => void): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export interface PublisherDeps {
  readonly connection: Connection;
  readonly makeQueue: (name: string) => JobQueue;
  readonly log: Logger;
  readonly callMs?: number;
}

/**
 * Publishes the jobs of the relay to BullMQ: one `Queue` per queue name over one connection. A job whose `jobId` is already there is
 * not an error in BullMQ, so a second publish of the same event adds nothing; `duplicates` is therefore always empty (N98).
 */
export class BullmqPublisher implements QueuePublisher {
  private readonly queues = new Map<string, JobQueue>();
  private closing: Promise<void> | null = null;

  constructor(private readonly deps: PublisherDeps) {}

  async publish(jobs: readonly EventJob[]): Promise<{ readonly duplicates: readonly string[] }> {
    await this.ready();
    const byQueue = new Map<string, EventJob[]>();
    for (const job of jobs) byQueue.set(job.queue, [...(byQueue.get(job.queue) ?? []), job]);
    await Promise.all(
      [...byQueue].map(([name, group]) =>
        this.within(
          this.queueFor(name).addBulk(
            group.map((job) => ({
              name: job.data.type,
              data: job.data,
              opts: { ...JOB_OPTIONS, jobId: job.jobId },
            })),
          ),
        ),
      ),
    );
    return { duplicates: [] };
  }

  /** Waiting, paused (BullMQ counts them with `waiting`) and prioritized jobs: what a consumer has not started yet. */
  async waiting(queue: string): Promise<number> {
    await this.ready();
    return this.within(this.queueFor(queue).getJobCountByTypes('waiting', 'prioritized'));
  }

  /** Closes the queues, then the connection they share; the second call waits for the first. */
  close(): Promise<void> {
    this.closing ??= this.shutDown();
    return this.closing;
  }

  private async shutDown(): Promise<void> {
    const { connection, log } = this.deps;
    for (const queue of this.queues.values()) {
      await this.within(queue.close()).catch(() => log.warn('queue_close_failed'));
    }
    await this.within(connection.quit()).catch(() => {
      log.warn('queue_quit_failed');
      connection.disconnect();
    });
  }

  private queueFor(name: string): JobQueue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = this.deps.makeQueue(name);
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** A `Queue` made on a connection that is not up waits for it with no end (checked against a closed port), so wait here instead. */
  private async ready(): Promise<void> {
    const { connection } = this.deps;
    if (this.closing) throw new QueueDownError('the publisher is closed');
    if (connection.status === 'ready') return;
    let listener = (): void => undefined;
    const up = new Promise<void>((resolve) => {
      listener = resolve;
      connection.once('ready', listener);
    });
    try {
      await this.within(up);
    } finally {
      connection.off('ready', listener);
    }
  }

  private within<T>(call: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new QueueDownError('the queue did not answer in time')),
        this.deps.callMs ?? QUEUE_CALL_MS,
      );
    });
    return Promise.race([call, late]).finally(() => clearTimeout(timer));
  }
}

/** A listener for the `error` events of the connection and of the queues: without one they crash the process. Logs a code, rarely. */
export function throttledErrorLog(log: Logger, now: () => number): (error: unknown) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (error) => {
    if (now() - last < ERROR_LOG_EVERY_MS) return;
    last = now();
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    log.warn('queue_connection_error', { code: typeof code === 'string' ? code : null });
  };
}

/** The publisher over a real connection to `REDIS_URL`. The address (it can hold a password) is never logged. */
export function createBullmqPublisher(
  redisUrl: string,
  log: Logger,
  now: () => number = Date.now,
): BullmqPublisher {
  const onError = throttledErrorLog(log, now);
  // Fail fast: with the offline queue on, ioredis would hold every command while the server is down.
  const connection = new Redis(redisUrl, {
    enableOfflineQueue: false,
    connectTimeout: QUEUE_CALL_MS,
    commandTimeout: QUEUE_CALL_MS,
  });
  connection.on('error', onError);
  return new BullmqPublisher({
    connection,
    log,
    makeQueue: (name) => {
      const queue = new Queue(name, { connection });
      queue.on('error', onError);
      return queue;
    },
  });
}
