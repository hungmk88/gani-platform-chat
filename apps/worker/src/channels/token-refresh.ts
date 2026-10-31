import type { ChannelRefreshClaim, ChannelRefreshKey, RefreshedTokens } from '@gani/db';

import type { Logger } from '../logger.js';
import { forEachLimited } from '../relay/outbox-relay.js';

/** What the job needs from the database: every call is one short transaction of one organisation (zalo-channel spec §4, N173). */
export interface RefreshStore {
  dueOrgs(limit: number, window: RefreshWindow): Promise<string[]>;
  /** One due account of the organisation, claimed, or null when none is left. */
  claim(orgId: string, window: RefreshWindow): Promise<ChannelRefreshClaim | null>;
  complete(orgId: string, key: ChannelRefreshKey, tokens: RefreshedTokens): Promise<boolean>;
  fail(orgId: string, key: ChannelRefreshKey, failure: RefreshFailure): Promise<string | null>;
}

export interface RefreshWindow {
  readonly beforeSeconds: number;
  readonly leaseSeconds: number;
}

export interface RefreshFailure {
  readonly errorCode: string;
  readonly disconnect: boolean;
  readonly warnSeconds: number;
}

/** What the platform answered: new tokens, or a code; `refused` means the token is no good any more (never tried again). */
export type RefreshOutcome =
  | { readonly ok: true; readonly tokens: RefreshedTokens }
  | { readonly ok: false; readonly code: string; readonly refused: boolean };

/**
 * The platform's side (B2-3, packages/channels): it gets the claim with its ciphertexts and gives the new tokens back as ciphertext of
 * SecretBox under the claim's `keyVersion`, so the worker never holds a plain token and SecretBox stays the one place that encrypts
 * (spec §2). The call is cut at `timeoutMs`: `signal` aborts then.
 */
export interface TokenRefresher {
  refresh(claim: ChannelRefreshClaim, signal: AbortSignal): Promise<RefreshOutcome>;
}

export interface ChannelRefreshSettings extends RefreshWindow {
  readonly pollMs: number;
  /** One platform call at most; the lease must cover two of them (checked by the config). */
  readonly timeoutMs: number;
  readonly warnSeconds: number;
  readonly orgsPerTick: number;
  readonly orgParallel: number;
}

/** What the job counts, for `/metrics`: one result per refresh, never an organisation. */
export interface RefreshMetrics {
  refreshed(result: 'ok' | 'failed' | 'refused' | 'lease_lost'): void;
}

export interface ChannelTokenRefreshDeps {
  readonly store: RefreshStore;
  readonly refresher: TokenRefresher;
  readonly log: Logger;
  readonly settings: ChannelRefreshSettings;
  readonly shutdownMs: number;
  readonly metrics?: RefreshMetrics;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** The accounts one organisation can have refreshed in one pass: a guard against a store that keeps handing out the same one. */
const MAX_PER_ORG = 100;

class RefreshTimeoutError extends Error {}

/** `run`, aborted and rejected with RefreshTimeoutError once `ms` have passed. */
async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RefreshTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renews the tokens of the channel accounts before they expire (zalo-channel spec §4, B2). For each organisation that has an account
 * due, it claims **one account at a time** and calls the platform outside any transaction, so a claim never waits behind the calls of
 * other accounts and outlives its lease (a refresh token may be good for one use only: two refreshes break the channel). The result is
 * written under the same claim; a claim taken back meanwhile writes nothing and is only logged. Logs carry ids and codes, never a token.
 */
export class ChannelTokenRefreshJob {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: ChannelTokenRefreshDeps) {}

  /** One pass. True when the list of organisations was full, so there is probably more: ask again at once. */
  async tick(): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const orgs = await store.dueOrgs(settings.orgsPerTick, settings);
    await forEachLimited(orgs, settings.orgParallel, async (orgId) => {
      try {
        await this.refreshOrg(orgId);
      } catch (error) {
        log.error('channel_refresh_org_failed', {
          orgId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    return orgs.length === settings.orgsPerTick;
  }

  private async refreshOrg(orgId: string): Promise<void> {
    for (let n = 0; n < MAX_PER_ORG && !this.stopping; n++) {
      const claim = await this.deps.store.claim(orgId, this.deps.settings);
      if (!claim) return;
      await this.refreshOne(orgId, claim);
    }
  }

  private async refreshOne(orgId: string, claim: ChannelRefreshClaim): Promise<void> {
    const { store, refresher, log, settings, metrics } = this.deps;
    const key = { id: claim.id, claimedAt: claim.claimedAt };
    const ids = { orgId, channelAccountId: claim.id };
    let outcome: RefreshOutcome;
    try {
      outcome = await withDeadline(settings.timeoutMs, (signal) =>
        refresher.refresh(claim, signal),
      );
    } catch (error) {
      const code = error instanceof RefreshTimeoutError ? 'E_TOKEN_TIMEOUT' : 'E_TOKEN_CLIENT';
      outcome = { ok: false, code, refused: false };
    }
    if (outcome.ok) {
      if (await store.complete(orgId, key, outcome.tokens)) {
        log.info('channel_token_refreshed', ids);
        metrics?.refreshed('ok');
      } else {
        log.warn('channel_refresh_lease_lost', ids);
        metrics?.refreshed('lease_lost');
      }
      return;
    }
    const code = CODE.test(outcome.code) ? outcome.code : 'E_TOKEN_CLIENT';
    const failure = {
      errorCode: code,
      disconnect: outcome.refused,
      warnSeconds: settings.warnSeconds,
    };
    const status = await store.fail(orgId, key, failure);
    if (status === null) {
      log.warn('channel_refresh_lease_lost', ids);
      metrics?.refreshed('lease_lost');
    } else if (status === 'disconnected') {
      log.error('channel_disconnected', { ...ids, code });
      metrics?.refreshed('refused');
    } else {
      log.warn('channel_refresh_failed', { ...ids, code, status });
      metrics?.refreshed('failed');
    }
  }

  start(): void {
    if (this.loop) throw new Error('the channel token refresh is already started');
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let more = false;
      try {
        more = await this.tick();
      } catch (error) {
        this.deps.log.error('channel_refresh_tick_failed', {
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

  /** Stops after the account in progress (its result is written, not left to the lease), wakes the pause. False past `shutdownMs`. */
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
      this.deps.log.warn('channel_refresh_shutdown_timeout', { shutdownMs: this.deps.shutdownMs });
    return clean;
  }
}
