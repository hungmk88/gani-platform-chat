// The consumer side of BullMQ: the rest of the worker sees `QueueSource` (src/consumer/event-consumer.ts).
import { UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import type { QueueSource } from '../consumer/event-consumer.js';
import type { Logger } from '../logger.js';
import { EVENT_QUEUE_REGISTRY, QUEUE_CALL_MS, throttledErrorLog } from './bullmq-publisher.js';

/** The part of an ioredis connection the source uses. */
export interface RegistryConnection {
  smembers(key: string): Promise<string[]>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

/** The part of a BullMQ `Worker` the source uses. */
export interface JobWorker {
  close(): Promise<void>;
}

export type MakeWorker = (queue: string, run: (data: unknown) => Promise<void>) => JobWorker;

export interface SourceDeps {
  readonly connection: RegistryConnection;
  readonly makeWorker: MakeWorker;
  readonly log: Logger;
  readonly callMs?: number;
}

const isPermanent = (error: unknown): error is Error =>
  error instanceof Error && 'permanent' in error && error.permanent === true;

/**
 * One BullMQ `Worker` per event queue, over one shared connection (each `Worker` adds its own blocking connection, so the number of
 * queues is capped by the consumer, N141). A permanent failure (no tenant, not an event) becomes an `UnrecoverableError`: the job is
 * failed at once instead of being tried five times.
 */
export class BullmqSource implements QueueSource {
  private readonly workers: JobWorker[] = [];
  private closing: Promise<void> | null = null;

  constructor(private readonly deps: SourceDeps) {}

  /** The registry, read in bounded time: a connection that is down must not hold the discovery for ever. */
  queues(): Promise<string[]> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('the registry did not answer in time')),
        this.deps.callMs ?? QUEUE_CALL_MS,
      );
    });
    return Promise.race([this.deps.connection.smembers(EVENT_QUEUE_REGISTRY), late]).finally(() =>
      clearTimeout(timer),
    );
  }

  subscribe(queue: string, handle: (data: unknown) => Promise<void>): Promise<void> {
    if (this.closing) return Promise.reject(new Error('the source is closed'));
    this.workers.push(
      this.deps.makeWorker(queue, async (data) => {
        try {
          await handle(data);
        } catch (error) {
          throw isPermanent(error) ? new UnrecoverableError(error.message) : error;
        }
      }),
    );
    return Promise.resolve();
  }

  /** Closes every worker (each waits for its running jobs), then the connection; the second call waits for the first. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      const { connection, log } = this.deps;
      await Promise.all(
        this.workers.map((w) => w.close().catch(() => log.warn('event_worker_close_failed'))),
      );
      await connection.quit().catch(() => {
        log.warn('event_source_quit_failed');
        connection.disconnect();
      });
    })();
    return this.closing;
  }
}

/** The source over a real connection to `REDIS_URL`. The address (it can hold a password) is never logged. */
export function createBullmqSource(
  redisUrl: string,
  log: Logger,
  concurrency: number,
): BullmqSource {
  const onError = throttledErrorLog(log, Date.now);
  // `maxRetriesPerRequest: null` is what BullMQ asks of a connection a Worker uses.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', onError);
  return new BullmqSource({
    connection,
    log,
    makeWorker: (queue, run) => {
      const worker = new Worker(queue, (job) => run(job.data), { connection, concurrency });
      worker.on('error', onError);
      return worker;
    },
  });
}
