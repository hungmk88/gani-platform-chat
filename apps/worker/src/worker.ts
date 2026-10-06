import type { WorkerConfig } from './config.js';
import type { Logger } from './logger.js';
import { OutboxRelay, type QueuePublisher, type RelayStore } from './relay/outbox-relay.js';

export interface WorkerDeps {
  readonly store: RelayStore;
  readonly queue: QueuePublisher & { close(): Promise<void> };
  readonly pool: { end(): Promise<void> };
  readonly log: Logger;
  readonly settings: WorkerConfig['outbox'];
}

export interface RunningWorker {
  /** Stops the relay, then closes the queue, then the pool. True when all three went well; the second call gives the first answer. */
  shutdown(): Promise<boolean>;
}

/** Starts the relay. The order of the shutdown matters: the relay uses the queue and the pool, so they close after it, not before. */
export function startWorker(deps: WorkerDeps): RunningWorker {
  const { store, queue, pool, log, settings } = deps;
  const relay = new OutboxRelay({ store, queue, log, settings });
  relay.start();

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
        const closed = await step('queue', () => queue.close());
        const ended = await step('pool', () => pool.end());
        return stopped && closed && ended;
      })();
      return shutdown;
    },
  };
}
