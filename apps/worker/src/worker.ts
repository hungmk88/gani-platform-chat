import type { WorkerConfig } from './config.js';
import { EventConsumer, type EventHandlers, type QueueSource } from './consumer/event-consumer.js';
import { InboundProcessor, type InboundStore } from './inbound/inbound-processor.js';
import type { Logger } from './logger.js';
import { PartitionMaintenanceJob, type PartitionStore } from './maintenance/partition-job.js';
import type { RelayMetrics } from './metrics.js';
import { OutboxRelay, type QueuePublisher, type RelayStore } from './relay/outbox-relay.js';

export interface WorkerDeps {
  readonly store: RelayStore;
  readonly queue: QueuePublisher & { close(): Promise<void> };
  readonly pool: { end(): Promise<void> };
  readonly log: Logger;
  readonly settings: WorkerConfig['outbox'];
  /** The partition maintenance (PM-2b): absent, it is not run (the tests of the relay do not need it). */
  readonly maintenance?: PartitionStore;
  /** The processing of stored webhooks (inbound spec §2–3): absent, it is not run (the tests of the relay do not need it). */
  readonly inbound?: { readonly store: InboundStore; readonly settings: WorkerConfig['inbound'] };
  /** The consumer of the event queues (N141): absent, it is not run (EVENTS_CONSUMER_ENABLED=0, and the tests of the relay). */
  readonly events?: {
    readonly source: QueueSource;
    readonly handlers: EventHandlers;
    readonly settings: WorkerConfig['events'];
    /** What the handlers send through (the realtime emitter, V8b): closed once the consumer has stopped. */
    readonly emitter?: { close(): Promise<void> };
  };
  /** What the relay counts, for `/metrics` and `/healthz` (OPS-02). */
  readonly metrics?: RelayMetrics;
  /** The HTTP endpoints: closed right after the relay stops, so a probe sees the worker go before the queue and the pool close. */
  readonly http?: { close(): Promise<void> };
}

export interface RunningWorker {
  /** Stops the relay, then closes the HTTP endpoints, then stops the inbound processor, then closes the queue and the pool. True when
   * all went well; the second call gives the first answer. */
  shutdown(): Promise<boolean>;
}

/** Starts the relay (and the inbound processor, the event consumer and the partition job when given). The order of the shutdown matters: the relay uses the queue and the pool, so they close after it, not before. */
export function startWorker(deps: WorkerDeps): RunningWorker {
  const { store, queue, pool, log, settings } = deps;
  const relay = new OutboxRelay({ store, queue, log, settings, metrics: deps.metrics });
  relay.start();
  const job = deps.maintenance
    ? new PartitionMaintenanceJob({ store: deps.maintenance, log })
    : null;
  job?.start();
  const inbound = deps.inbound
    ? new InboundProcessor({ ...deps.inbound, log, shutdownMs: settings.shutdownMs })
    : null;
  inbound?.start();
  const consumer = deps.events
    ? new EventConsumer({ ...deps.events, log, shutdownMs: settings.shutdownMs })
    : null;
  consumer?.start();

  // A step that fails or hangs is logged and does not stop the next one; `pool.end()` waits for a connection a late pass still holds.
  // `relay.stop()` has its own deadline (and its own warning), so only the other two are timed here.
  const step = async (
    name: string,
    run: () => Promise<boolean | void>,
    timed = true,
  ): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>((resolve) => {
      if (timed) timer = setTimeout(() => resolve('late'), settings.shutdownMs);
    });
    try {
      const done = await Promise.race([run().then((ok) => ok !== false), late]);
      if (done === 'late') log.warn('shutdown_step_late', { step: name });
      return done === true;
    } catch (error) {
      log.error('shutdown_step_failed', {
        step: name,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  let shutdown: Promise<boolean> | null = null;
  return {
    shutdown() {
      shutdown ??= (async () => {
        const stopped = await step('relay', () => relay.stop(), false);
        const { http } = deps;
        const served = http ? await step('http', () => http.close()) : true;
        // Like the relay, the processor has its own deadline; it uses the pool, so it ends before the pool closes.
        const drained = inbound ? await step('inbound', () => inbound.stop(), false) : true;
        // After the loops that feed the queues; it waits for the jobs running and has its own deadline too.
        const consumed = consumer ? await step('events', () => consumer.stop(), false) : true;
        const emitter = deps.events?.emitter;
        const silent = emitter ? await step('emitter', () => emitter.close()) : true;
        // The job uses the pool too: it ends before the queue and the pool close.
        const maintained = job ? await step('partition_job', () => job.stop()) : true;
        const closed = await step('queue', () => queue.close());
        const ended = await step('pool', () => pool.end());
        return stopped && served && drained && consumed && silent && maintained && closed && ended;
      })();
      return shutdown;
    },
  };
}
