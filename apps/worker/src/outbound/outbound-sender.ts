import type { OutboundClaim, OutboundKey } from '@gani/db';

import type { Logger } from '../logger.js';
import { backoffSeconds } from '../relay/job.js';
import { forEachLimited } from '../relay/outbox-relay.js';

// The outbound worker (O2, N185, zalo-channel-spec §5): sends the pending deliveries of every organisation to their channel. For each
// organisation with work it goes round the workspaces and claims **one delivery at a time**, re-checks the window of the channel just
// before the send (the one gate, counting only the messages before this one), calls the channel outside any transaction, and writes
// the result under the same claim. Decisions of A (02/11/2026): 5 attempts with the relay's backoff, then failed with a code; a window
// closed meanwhile fails at once with CHANNEL_WINDOW_CLOSED, never a paid send; the oldest pending delivery of a conversation first
// (the store's claim). Logs carry ids and codes, never the text of a message nor a token.

/** What the job needs from the database: every call is one short transaction of one organisation and workspace. */
export interface OutboundStore {
  pendingOrgs(limit: number, leaseSeconds: number): Promise<string[]>;
  /** The live workspaces of the organisation, the ones the job goes round. */
  workspaces(orgId: string): Promise<string[]>;
  /** The next due delivery of the workspace, claimed, or null when none is left. */
  claim(orgId: string, workspaceId: string, leaseSeconds: number): Promise<OutboundClaim | null>;
  /** Whether the channel's window still lets this message go, without paying: `open`, or `closed`. */
  window(orgId: string, claim: OutboundClaim, now: Date): Promise<'open' | 'closed'>;
  complete(
    orgId: string,
    workspaceId: string,
    key: OutboundKey,
    platformMessageId: string,
  ): Promise<boolean>;
  retry(
    orgId: string,
    workspaceId: string,
    key: OutboundKey,
    failure: { readonly errorCode: string; readonly delaySeconds: number },
  ): Promise<boolean>;
  fail(orgId: string, workspaceId: string, key: OutboundKey, errorCode: string): Promise<boolean>;
}

/** What the channel answered: the platform's id of the message, or a code; `retry` false means trying again cannot help. */
export type SendOutcome =
  | { readonly ok: true; readonly platformMessageId: string }
  | { readonly ok: false; readonly code: string; readonly retry: boolean };

/** One channel type's side (O3: Zalo). It gets the claim with the account's ciphertext token; the call is cut at `timeoutMs`. */
export interface ChannelSender {
  send(claim: OutboundClaim, signal: AbortSignal): Promise<SendOutcome>;
}

export type ChannelSenders = Readonly<Partial<Record<string, ChannelSender>>>;

export interface OutboundSettings {
  readonly pollMs: number;
  /** A claim older than this is taken back; it must cover two calls (checked by the config). */
  readonly leaseSeconds: number;
  readonly timeoutMs: number;
  /** Attempts before failed (A 02/11/2026: 5). */
  readonly maxAttempts: number;
  readonly orgsPerTick: number;
  readonly orgParallel: number;
}

/** What the job counts, for `/metrics`: one result per attempt, never an organisation. */
export interface OutboundMetrics {
  delivered(result: 'sent' | 'retried' | 'failed' | 'lease_lost'): void;
}

export interface OutboundSenderDeps {
  readonly store: OutboundStore;
  readonly senders: ChannelSenders;
  readonly log: Logger;
  readonly settings: OutboundSettings;
  readonly shutdownMs: number;
  readonly metrics?: OutboundMetrics;
  readonly now?: () => Date;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Deliveries one workspace can have sent in one pass: a guard against a store that keeps handing out the same one. */
const MAX_PER_WORKSPACE = 100;
/** A channel type without a sender waits this long between its attempts, then fails like any other. */
const NO_SENDER_DELAY_S = 300;
const LIVE = new Set(['connected', 'token_expiring']);

class SendTimeoutError extends Error {}

async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SendTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

export class OutboundSenderJob {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: OutboundSenderDeps) {}

  /** One pass. True when the list of organisations was full, so there is probably more: ask again at once. */
  async tick(): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const orgs = await store.pendingOrgs(settings.orgsPerTick, settings.leaseSeconds);
    await forEachLimited(orgs, settings.orgParallel, async (orgId) => {
      try {
        for (const workspaceId of await store.workspaces(orgId)) {
          if (this.stopping) break;
          await this.sendWorkspace(orgId, workspaceId);
        }
      } catch (error) {
        log.error('outbound_org_failed', {
          orgId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    return orgs.length === settings.orgsPerTick;
  }

  private async sendWorkspace(orgId: string, workspaceId: string): Promise<void> {
    for (let n = 0; n < MAX_PER_WORKSPACE && !this.stopping; n++) {
      const claim = await this.deps.store.claim(
        orgId,
        workspaceId,
        this.deps.settings.leaseSeconds,
      );
      if (!claim) return;
      await this.sendOne(orgId, claim);
    }
  }

  private async sendOne(orgId: string, claim: OutboundClaim): Promise<void> {
    const { store, senders, settings } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    const sender = claim.account ? senders[claim.account.type] : undefined;
    if (!claim.account || !LIVE.has(claim.account.status) || claim.externalUserId === null)
      return this.finish(orgId, claim, { ok: false, code: 'E_CHANNEL_UNAVAILABLE', retry: true });
    if (!sender)
      return this.finish(
        orgId,
        claim,
        { ok: false, code: 'E_NO_SENDER', retry: true },
        NO_SENDER_DELAY_S,
      );
    if ((await store.window(orgId, claim, now)) === 'closed')
      return this.finish(orgId, claim, { ok: false, code: 'CHANNEL_WINDOW_CLOSED', retry: false });
    let outcome: SendOutcome;
    try {
      outcome = await withDeadline(settings.timeoutMs, (signal) => sender.send(claim, signal));
    } catch (error) {
      const code = error instanceof SendTimeoutError ? 'E_SEND_TIMEOUT' : 'E_SEND_CLIENT';
      outcome = { ok: false, code, retry: true };
    }
    return this.finish(orgId, claim, outcome);
  }

  private async finish(
    orgId: string,
    claim: OutboundClaim,
    outcome: SendOutcome,
    delaySeconds?: number,
  ): Promise<void> {
    const { store, log, settings, metrics } = this.deps;
    const ws = claim.workspaceId;
    const key = { id: claim.id, claimedAt: claim.claimedAt };
    const ids = { orgId, workspaceId: ws, deliveryId: claim.id, messageId: claim.messageId };
    let written: boolean;
    let result: 'sent' | 'retried' | 'failed';
    let code = '';
    if (outcome.ok) {
      written = await store.complete(orgId, ws, key, outcome.platformMessageId);
      result = 'sent';
    } else {
      code = CODE.test(outcome.code) ? outcome.code : 'E_SEND_CLIENT';
      if (outcome.retry && claim.attempts < settings.maxAttempts) {
        const delay = delaySeconds ?? backoffSeconds(claim.attempts);
        written = await store.retry(orgId, ws, key, { errorCode: code, delaySeconds: delay });
        result = 'retried';
      } else {
        written = await store.fail(orgId, ws, key, code);
        result = 'failed';
      }
    }
    if (!written) {
      log.warn('outbound_lease_lost', ids);
      metrics?.delivered('lease_lost');
      return;
    }
    metrics?.delivered(result);
    if (result === 'sent') log.info('outbound_sent', ids);
    else if (result === 'failed') log.error('outbound_failed', { ...ids, code });
    else log.warn('outbound_retry', { ...ids, code, attempts: claim.attempts });
  }

  start(): void {
    if (this.loop) throw new Error('the outbound sender is already started');
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let more = false;
      try {
        more = await this.tick();
      } catch (error) {
        this.deps.log.error('outbound_tick_failed', {
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

  /** Stops after the delivery in progress (its result is written, not left to the lease), wakes the pause. False past `shutdownMs`. */
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
      this.deps.log.warn('outbound_shutdown_timeout', { shutdownMs: this.deps.shutdownMs });
    return clean;
  }
}
