import type { ClaimedInboundEvent, InboundFailure } from '@gani/db';

import type { WorkerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { backoffSeconds } from '../relay/job.js';
import { forEachLimited } from '../relay/outbox-relay.js';
import { InboundLeaseLostError } from './process-event.js';

/** What the processor needs from the database: every call is one short transaction of one organisation (inbound spec §2–3). */
export interface InboundStore {
  pendingOrgs(limit: number, leaseSeconds: number): Promise<string[]>;
  reapExpired(orgId: string, leaseSeconds: number, maxAttempts: number): Promise<number>;
  pendingWorkspaces(orgId: string): Promise<string[]>;
  claim(orgId: string, workspaceId: string, limit: number): Promise<ClaimedInboundEvent[]>;
  /** One event in its own transaction, in the tenant of the event; rejects with `InboundLeaseLostError` after a rollback. */
  process(event: ClaimedInboundEvent): Promise<'processed' | 'ignored'>;
  fail(orgId: string, failure: InboundFailure): Promise<'pending' | 'dead_letter' | null>;
}

export interface InboundProcessorDeps {
  readonly store: InboundStore;
  readonly log: Logger;
  readonly settings: WorkerConfig['inbound'];
  readonly shutdownMs: number;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * A code for `inbound_events.last_error` (^[A-Z][A-Z0-9_]{0,63}$), never a message: a PostgreSQL state becomes `E_PG_<state>`, a
 * code of the domain (`version_conflict`) `E_VERSION_CONFLICT`, one already in the form stays, anything else is `E_PROCESS`.
 */
export function inboundErrorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  if (/^[0-9A-Z]{5}$/.test(code) && /[0-9]/.test(code)) return `E_PG_${code}`;
  if (/^[a-z][a-z0-9_]{0,61}$/.test(code)) return `E_${code.toUpperCase()}`;
  return CODE.test(code) ? code : 'E_PROCESS';
}

/**
 * Turns the stored webhooks into messages (inbound spec §2–3): for each organisation that has work, take back expired claims, then go
 * round its workspaces and claim a small batch of each, so a workspace that floods does not hold the others back (Phụ lục §15).
 * Each event is its own transaction: one that fails is put back with a backoff, or set aside (`dead_letter`) after `maxAttempts`,
 * and the next one goes on. A lost claim is only logged: the other worker that holds it now stores the message.
 */
export class InboundProcessor {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: InboundProcessorDeps) {}

  /** One pass. True when a workspace gave a full batch, so there is probably more: ask again at once. */
  async tick(): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const orgs = await store.pendingOrgs(settings.orgsPerTick, settings.leaseSeconds);
    let more = false;
    await forEachLimited(orgs, settings.orgParallel, async (orgId) => {
      try {
        more = (await this.processOrg(orgId)) || more;
      } catch (error) {
        log.error('inbound_org_failed', {
          orgId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    return more;
  }

  private async processOrg(orgId: string): Promise<boolean> {
    const { store, settings } = this.deps;
    await store.reapExpired(orgId, settings.leaseSeconds, settings.maxAttempts);
    let more = false;
    for (const workspaceId of await store.pendingWorkspaces(orgId)) {
      if (this.stopping) break;
      const claimed = await store.claim(orgId, workspaceId, settings.batchSize);
      for (const event of claimed) await this.processEvent(orgId, event);
      more ||= claimed.length === settings.batchSize;
    }
    return more;
  }

  private async processEvent(orgId: string, event: ClaimedInboundEvent): Promise<void> {
    const { store, log, settings } = this.deps;
    try {
      await store.process(event);
      return;
    } catch (error) {
      if (error instanceof InboundLeaseLostError) {
        log.warn('inbound_lease_lost', { orgId, eventId: event.id });
        return;
      }
      const errorCode = inboundErrorCode(error);
      const outcome = await store.fail(orgId, {
        id: event.id,
        receivedAt: event.receivedAt,
        attempts: event.attempts,
        errorCode,
        maxAttempts: settings.maxAttempts,
        retryAfterSeconds: backoffSeconds(event.attempts),
      });
      if (outcome === 'dead_letter')
        log.error('inbound_dead_letter', { orgId, eventId: event.id, code: errorCode });
      else log.warn('inbound_failed', { orgId, eventId: event.id, code: errorCode });
    }
  }

  start(): void {
    if (this.loop) throw new Error('the inbound processor is already started');
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let more = false;
      try {
        more = await this.tick();
      } catch (error) {
        this.deps.log.error('inbound_tick_failed', {
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

  /** Stops after the batch in progress (claimed events are not left to the lease), wakes the pause. False past `shutdownMs`. */
  async stop(): Promise<boolean> {
    this.stopping = true;
    this.wake?.();
    if (!this.loop) return true;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), this.deps.shutdownMs);
    });
    const clean = await Promise.race([this.loop.then(() => true as const), late]);
    clearTimeout(timer);
    if (!clean)
      this.deps.log.warn('inbound_shutdown_timeout', { shutdownMs: this.deps.shutdownMs });
    return clean;
  }
}
