import type { TenantContext } from '@gani/db';

import type { Logger } from '../logger.js';
import type { ConsumerMetrics } from '../metrics.js';
import type { EventJobData } from '../relay/job.js';
import { JobTenantMissingError, runForJob } from '../tenant-job.js';

/**
 * What a consumer does with one event (outbox spec §6): it MUST be idempotent by `event.id` (a job can run twice: after a crash, or
 * once BullMQ has dropped the finished job, E-04), MUST NOT rely on order (`aggregate.version`, `sequenceNumber` tell old from new)
 * and logs ids only, never the payload. There is no store of the events already consumed (spec §6.4, N141): the first one is built
 * with the first consumer that is not idempotent by itself.
 */
export type EventHandler = (event: EventJobData, tenant: TenantContext) => Promise<void>;
export type EventHandlers = Readonly<Record<string, EventHandler>>;

/** What the consumer needs from the queue; it does not know BullMQ. */
export interface QueueSource {
  /** The names in the registry the publisher writes to (N141). */
  queues(): Promise<string[]>;
  /** Starts taking the jobs of a queue. A rejection with a `PermanentEventError` fails the job at once, any other is retried. */
  subscribe(queue: string, handle: (data: unknown) => Promise<void>): Promise<void>;
  /** Stops taking jobs, waits for the ones running, and closes. */
  close(): Promise<void>;
}

/** A job that no retry can fix (no tenant, not an event): BullMQ must not try it again. The message is a code. */
export class PermanentEventError extends Error {
  readonly permanent = true;
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermanentEventError';
  }
}

export interface EventConsumerDeps {
  readonly source: QueueSource;
  readonly handlers: EventHandlers;
  readonly log: Logger;
  readonly settings: { readonly discoveryMs: number; readonly maxQueues: number };
  readonly shutdownMs: number;
  readonly metrics?: ConsumerMetrics;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The names the relay makes (`queueNameOf`): anything else in the registry is not ours to consume. */
const EVENT_QUEUE = new RegExp(`^q\\.events\\.(ws|org)\\.${UUID}$`);

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * Consumes the event queues (outbox spec §5–6): finds them in the registry, takes the jobs of each one, runs each job in the tenant
 * its payload names (P16: none, or a malformed one, fails the job at once and runs nothing) and hands it to the handler of its type.
 * An event no handler wants is done, not failed. A handler that throws lets BullMQ retry the job (5 attempts, then `failed`).
 */
export class EventConsumer {
  private readonly subscribed = new Set<string>();
  private readonly passedOver = new Set<string>();
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: EventConsumerDeps) {}

  /** Subscribes to the queues of the registry not yet taken. A name passed over is warned about once, and not looked at again. */
  async discover(): Promise<void> {
    const { source, log, settings } = this.deps;
    for (const name of await source.queues()) {
      if (this.stopping) return;
      if (this.subscribed.has(name) || this.passedOver.has(name)) continue;
      if (!EVENT_QUEUE.test(name) || this.subscribed.size >= settings.maxQueues) {
        this.passedOver.add(name);
        const full = EVENT_QUEUE.test(name);
        log.warn(full ? 'event_queues_full' : 'event_queue_unknown', {
          queue: name.slice(0, 100),
          max: settings.maxQueues,
        });
        continue;
      }
      await source.subscribe(name, (data) => this.handle(data));
      this.subscribed.add(name);
      this.deps.metrics?.queuesSubscribed(this.subscribed.size);
      log.info('event_queue_subscribed', { queue: name });
    }
  }

  async handle(data: unknown): Promise<void> {
    const { handlers, log } = this.deps;
    const event = data as Partial<EventJobData> | null;
    if (typeof event !== 'object' || event === null || !isText(event.id) || !isText(event.type))
      throw new PermanentEventError('E_NOT_AN_EVENT');
    const ids = { eventId: event.id, type: event.type };
    try {
      await runForJob({ orgId: event.orgId, workspaceId: event.workspaceId }, async (tenant) => {
        const handler = handlers[event.type as string];
        if (!handler) return log.info('event_unhandled', ids);
        try {
          await handler(event as EventJobData, tenant);
          this.deps.metrics?.jobHandled(true);
        } catch (error) {
          this.deps.metrics?.jobHandled(false);
          log.warn('event_handler_failed', {
            ...ids,
            error: error instanceof Error ? error.name : 'unknown',
          });
          throw error;
        }
      });
    } catch (error) {
      if (!(error instanceof JobTenantMissingError)) throw error;
      log.error('event_tenant_missing', ids);
      throw new PermanentEventError('E_TENANT_MISSING');
    }
  }

  start(): void {
    if (this.loop) throw new Error('the event consumer is already started');
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.discover();
      } catch (error) {
        this.deps.log.warn('event_discovery_failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      if (!this.stopping) await this.sleep(this.deps.settings.discoveryMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** Stops looking for queues, then closes the source, which waits for the jobs running. False past `shutdownMs`. */
  async stop(): Promise<boolean> {
    this.stopping = true;
    this.wake?.();
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.deps.shutdownMs);
    });
    const done = (async () => {
      await this.loop;
      await this.deps.source.close();
      return true as const;
    })();
    const clean = await Promise.race([done, late]);
    clearTimeout(timer);
    if (!clean)
      this.deps.log.warn('event_consumer_shutdown_timeout', { shutdownMs: this.deps.shutdownMs });
    return clean;
  }
}
