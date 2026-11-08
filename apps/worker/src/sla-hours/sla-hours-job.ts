import type { Logger } from '../logger.js';
import { forEachLimited } from '../relay/outbox-relay.js';
import type { SlaHoursStore } from './store.js';

export type { SlaHoursStore } from './store.js';

/** What the job reports for /metrics (cheap, never throws). */
export interface SlaHoursMetrics {
  slaHoursPass(moved: number): void;
  slaHoursLagHigh(): void;
}

export interface SlaHoursSettings {
  readonly pollMs: number;
  readonly orgsPerTick: number;
  readonly orgParallel: number;
  readonly batch: number;
}

export interface SlaHoursJobDeps {
  readonly store: SlaHoursStore;
  readonly log: Logger;
  readonly settings: SlaHoursSettings;
  readonly shutdownMs: number;
  readonly metrics?: SlaHoursMetrics;
  readonly now?: () => Date;
}

/** CEO 07/11/2026 (N211): a pass more than 2 minutes after the one before, 3 times in a row, is a lag to look into; 5 minutes of
 * failed passes is a stall. Neither stops the job, nor any other. */
const LAG_MS = 2 * 60_000;
const LAG_TIMES = 3;
const STALL_MS = 5 * 60_000;

/**
 * Moves the SLA clock with the opening hours (E4b, N211): every `pollMs` (60 s), for each organisation with a running SLA or one
 * paused outside the hours, each workspace that just closed pauses its running SLAs `outside_hours` and each that just opened runs
 * them again, from now (a late pass gives the agent the minutes it was late; CEO 07/11/2026), through the SlaClock (one transaction
 * a conversation, its lock first, actor system), which writes conversation.sla_changed. Logs carry ids and counts only.
 */
export class SlaHoursJob {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private lastPassAt: number | null = null;
  private lastOkAt: number | null = null;
  private lateInARow = 0;
  private stalled = false;

  constructor(private readonly deps: SlaHoursJobDeps) {}

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** One pass. True when a list was full (organisations or a workspace's batch), so there is probably more: ask again at once. */
  async tick(): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const at = this.now();
    this.watchLag(at.getTime());
    const orgs = await store.runningOrgs(settings.orgsPerTick);
    let more = orgs.length === settings.orgsPerTick;
    let moved = 0;
    await forEachLimited(orgs, settings.orgParallel, async (orgId) => {
      try {
        const done = await this.moveOrg(orgId, at);
        moved += done.moved;
        if (done.full) more = true;
      } catch (error) {
        log.error('sla_hours_org_failed', {
          orgId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    this.deps.metrics?.slaHoursPass(moved);
    return more;
  }

  private watchLag(at: number): void {
    const gap = this.lastPassAt === null ? 0 : at - this.lastPassAt;
    this.lastPassAt = at;
    this.lateInARow = gap > LAG_MS ? this.lateInARow + 1 : 0;
    if (this.lateInARow < LAG_TIMES) return;
    this.deps.log.warn('sla_job_lag_high', {
      lagSeconds: Math.round(gap / 1000),
      times: this.lateInARow,
    });
    this.deps.metrics?.slaHoursLagHigh();
  }

  private async moveOrg(orgId: string, at: Date): Promise<{ moved: number; full: boolean }> {
    const { store, settings, log } = this.deps;
    let [moved, full] = [0, false];
    for (const { workspaceId, conversationIds } of await store.toMove(orgId, at, settings.batch)) {
      let changed = 0;
      for (const id of conversationIds) {
        if (this.stopping) break;
        if (await store.move(orgId, workspaceId, id, at)) changed++;
      }
      if (conversationIds.length === settings.batch) full = true;
      moved += changed;
      log.info('sla_hours_moved', {
        orgId,
        workspaceId,
        moved: changed,
        listed: conversationIds.length,
      });
    }
    return { moved, full };
  }

  /** A pass ended: well, or with an error; past STALL_MS without a good one, says so once until the next good one. */
  private passEnded(ok: boolean): void {
    const at = this.now().getTime();
    if (ok) {
      this.lastOkAt = at;
      this.stalled = false;
      return;
    }
    const since = at - (this.lastOkAt ?? at);
    if (this.stalled || since < STALL_MS) return;
    this.stalled = true;
    this.deps.log.error('sla_job_stalled', { sinceSeconds: Math.round(since / 1000) });
  }

  start(): void {
    if (this.loop) throw new Error('the SLA hours job is already started');
    this.lastOkAt = this.now().getTime();
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let more = false;
      try {
        more = await this.tick();
        this.passEnded(true);
      } catch (error) {
        this.deps.log.error('sla_hours_tick_failed', {
          error: error instanceof Error ? error.name : 'unknown',
        });
        this.passEnded(false);
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

  /** Stops after the conversation in progress, wakes the pause. False past `shutdownMs`. */
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
      this.deps.log.warn('sla_hours_shutdown_timeout', { shutdownMs: this.deps.shutdownMs });
    return clean;
  }
}
