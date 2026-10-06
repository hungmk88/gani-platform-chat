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
    const claimed = await store.claim(orgId, settings.batchSize);
    if (claimed.length === 0) return false;
    const jobs = claimed.map(toJob);
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
}
