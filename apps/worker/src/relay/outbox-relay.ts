import type { ClaimedOutboxEvent, OutboxFailure } from '@gani/db';

import type { WorkerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { backoffSeconds, errorCodeOf, toJob, type EventJob } from './job.js';

/** What the relay needs from the database: every call is one short transaction of one organisation (outbox spec §4). */
export interface RelayStore {
  pendingOrgs(limit: number, leaseSeconds: number): Promise<string[]>;
  reapExpired(orgId: string, leaseSeconds: number, maxAttempts: number): Promise<number>;
  claim(orgId: string, limit: number): Promise<ClaimedOutboxEvent[]>;
  markPublished(orgId: string, ids: readonly string[]): Promise<number>;
  fail(orgId: string, failure: OutboxFailure): Promise<'pending' | 'dead_letter' | null>;
}

/** What the relay needs from the queue; it does not know BullMQ. `publish` throws when the queue did not take the jobs. */
export interface QueuePublisher {
  waiting(queue: string): Promise<number>;
  publish(jobs: readonly EventJob[]): Promise<{ readonly duplicates: readonly string[] }>;
}

export interface RelayDeps {
  readonly store: RelayStore;
  readonly queue: QueuePublisher;
  readonly log: Logger;
  readonly settings: WorkerConfig['outbox'];
}

async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runner = async (): Promise<void> => {
    for (let item = items[next++]; item !== undefined; item = items[next++]) await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/**
 * Moves the events of the outbox into the queue (outbox spec §4): for each organisation that has work, take back expired claims,
 * claim a batch, publish it, mark it. At least once: a crash between publish and mark publishes again after the lease, and the
 * `jobId` (the id of the event) lets the queue recognise it. Each organisation is a unit: one that fails does not stop the others.
 */
export class OutboxRelay {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  // The queues each organisation has published to since the start: backpressure looks at them before it claims anything.
  private readonly queues = new Map<string, Set<string>>();

  constructor(private readonly deps: RelayDeps) {}

  /** One pass over the organisations that have work. True when one gave a full batch, so there is probably more: ask again at once. */
  async tick(): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const orgs = await store.pendingOrgs(settings.orgsPerTick, settings.leaseSeconds);
    let more = false;
    await forEachLimited(orgs, settings.orgParallel, async (orgId) => {
      try {
        more = (await this.relayOrg(orgId)) || more;
      } catch (error) {
        log.error('relay_org_failed', {
          orgId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    return more;
  }

  private async relayOrg(orgId: string): Promise<boolean> {
    const { store, queue, log, settings } = this.deps;
    await store.reapExpired(orgId, settings.leaseSeconds, settings.maxAttempts);
    if (await this.isFull(orgId)) return false;
    const claimed = await store.claim(orgId, settings.batchSize);
    if (claimed.length === 0) return false;
    const jobs = claimed.map(toJob);
    const known = this.queues.get(orgId) ?? new Set<string>();
    for (const job of jobs) known.add(job.queue);
    this.queues.set(orgId, known);
    // MUTATION M1 (temporary, never to be merged): mark published BEFORE sending.
    await store.markPublished(
      orgId,
      claimed.map((e) => e.id),
    );
    let result;
    try {
      result = await queue.publish(jobs);
    } catch (error) {
      await this.failAll(orgId, claimed, errorCodeOf(error));
      return false;
    }
    if (result.duplicates.length > 0)
      log.info('duplicate_jobs', { orgId, count: result.duplicates.length });
    const marked = await store.markPublished(
      orgId,
      claimed.map((e) => e.id),
    );
    if (marked < claimed.length) log.warn('lease_lost', { orgId, count: claimed.length - marked });
    return claimed.length === settings.batchSize;
  }

  /**
   * Backpressure: an organisation whose queue is full is skipped for this pass, and the others go on (v2.2 §15). A queue that cannot
   * be asked (the server is down) skips the organisation the same way, with a warning: nothing is claimed, so no attempt is used (N99).
   */
  private async isFull(orgId: string): Promise<boolean> {
    const { queue, log, settings } = this.deps;
    for (const name of this.queues.get(orgId) ?? []) {
      let waiting: number;
      try {
        waiting = await queue.waiting(name);
      } catch (error) {
        log.warn('queue_unreachable', { orgId, queue: name, code: errorCodeOf(error) });
        return true;
      }
      if (waiting >= settings.queueMaxWaiting) {
        log.warn('queue_full', { orgId, queue: name, waiting, max: settings.queueMaxWaiting });
        return true;
      }
    }
    return false;
  }

  private async failAll(
    orgId: string,
    claimed: readonly ClaimedOutboxEvent[],
    errorCode: string,
  ): Promise<void> {
    const { store, log, settings } = this.deps;
    for (const event of claimed) {
      const failure = {
        id: event.id,
        attempts: event.attempts,
        errorCode,
        maxAttempts: settings.maxAttempts,
        retryAfterSeconds: backoffSeconds(event.attempts),
      };
      if ((await store.fail(orgId, failure)) === 'dead_letter')
        log.error('dead_letter', { orgId, eventId: event.id, code: errorCode });
    }
    log.warn('publish_failed', { orgId, count: claimed.length, code: errorCode });
  }

  start(): void {
    if (this.loop) throw new Error('the relay is already started');
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let more = false;
      try {
        more = await this.tick();
      } catch (error) {
        this.deps.log.error('relay_tick_failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      if (!this.stopping && !more) await this.sleep(this.deps.settings.pollMs);
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

  /** Stops after the pass in progress, starts no other, and wakes the pause. False when that took longer than `shutdownMs`. */
  async stop(): Promise<boolean> {
    this.stopping = true;
    this.wake?.();
    if (!this.loop) return true;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.deps.settings.shutdownMs);
    });
    const clean = await Promise.race([this.loop.then(() => true as const), late]);
    clearTimeout(timer);
    if (!clean)
      this.deps.log.warn('shutdown_timeout', { shutdownMs: this.deps.settings.shutdownMs });
    return clean;
  }
}
