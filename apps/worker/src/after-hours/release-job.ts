import type { Logger } from '../logger.js';
import { forEachLimited } from '../relay/outbox-relay.js';

/** What the job needs from the database; every call is one short transaction of one organisation (or of one of its workspaces). */
export interface ReleaseStore {
  heldOrgs(limit: number): Promise<string[]>;
  /** The workspaces of the organisation open at `at` that hold conversations, with at most `limit` of their ids each. */
  openWithHeld(
    orgId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly workspaceId: string; readonly conversationIds: readonly string[] }[]>;
  /** T08 of one conversation in its own transaction: true when released, false when it is no longer held (claimed, contended). */
  release(orgId: string, workspaceId: string, conversationId: string): Promise<boolean>;
}

export interface ReleaseSettings {
  readonly pollMs: number;
  readonly orgsPerTick: number;
  readonly orgParallel: number;
  /** The conversations one workspace releases in one pass. */
  readonly batch: number;
}

export interface AfterHoursReleaseDeps {
  readonly store: ReleaseStore;
  readonly log: Logger;
  readonly settings: ReleaseSettings;
  readonly shutdownMs: number;
  readonly now?: () => Date;
}

/**
 * Releases the conversations held outside business hours once their workspace opens (T08, Brief F6, C10-4b, N193): every `pollMs`
 * (60 s, CEO 03/11/2026), for each organisation that holds one, each open workspace hands its held conversations to the queue through
 * the ConversationStateMachine (one transaction each, actor system), which writes conversation_events and the handoff of the outbox.
 * One taken by a person meanwhile (T06) is left alone. Logs carry ids and counts only.
 */
export class AfterHoursReleaseJob {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: AfterHoursReleaseDeps) {}

  /** One pass. True when a list was full (organisations or a workspace's batch), so there is probably more: ask again at once. */
  async tick(): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const orgs = await store.heldOrgs(settings.orgsPerTick);
    let more = orgs.length === settings.orgsPerTick;
    await forEachLimited(orgs, settings.orgParallel, async (orgId) => {
      try {
        if (await this.releaseOrg(orgId)) more = true;
      } catch (error) {
        log.error('after_hours_release_org_failed', {
          orgId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    });
    return more;
  }

  private async releaseOrg(orgId: string): Promise<boolean> {
    const { store, settings, log } = this.deps;
    const open = await store.openWithHeld(
      orgId,
      (this.deps.now ?? (() => new Date()))(),
      settings.batch,
    );
    let full = false;
    for (const { workspaceId, conversationIds } of open) {
      let released = 0;
      for (const id of conversationIds) {
        if (this.stopping) break;
        if (await store.release(orgId, workspaceId, id)) released++;
      }
      if (conversationIds.length === settings.batch) full = true;
      log.info('after_hours_released', {
        orgId,
        workspaceId,
        released,
        held: conversationIds.length,
      });
    }
    return full;
  }

  start(): void {
    if (this.loop) throw new Error('the after-hours release is already started');
    this.loop = this.run();
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let more = false;
      try {
        more = await this.tick();
      } catch (error) {
        this.deps.log.error('after_hours_release_tick_failed', {
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
      this.deps.log.warn('after_hours_release_shutdown_timeout', {
        shutdownMs: this.deps.shutdownMs,
      });
    return clean;
  }
}
