import type { DefaultPartitionRows, EnsuredPartitions } from '@gani/db';

import type { LogFields, Logger } from '../logger.js';

// The partition maintenance (PM-2b, N110, N121): once a day it makes the next months of the log tables, removes old inbound
// duplicate-guard keys, and looks at the DEFAULT partitions. A timer of this process, not a BullMQ job: it needs only PostgreSQL.
// Several workers may run it at once (the database function takes an advisory lock; the purge is idempotent). It speaks in the log,
// with the same six numbers in every line (no metrics endpoint yet: E-01), and never a customer name or a word of a message.

/** 19:00 UTC is 02:00 in Vietnam, outside the working day. */
export const PARTITION_JOB_HOUR_UTC = 19;
export const PARTITION_MONTHS_AHEAD = 3;
/** Age at which an inbound duplicate-guard key goes (the function refuses less than 30). Lower it when Zalo's retry policy is known. */
export const INBOUND_KEY_RETENTION_DAYS = 35;
export const PURGE_BATCH = 10_000;
/** At most this many batches per run: what is left waits for the next run, and the line says so. */
export const PURGE_MAX_ROUNDS = 20;
/** The first attempt, then up to three more after these waits, each spread by +-20%. */
export const RETRY_DELAYS_MS = [1_000, 4_000, 16_000] as const;
export const RETRY_JITTER = 0.2;
/** After a run in which every attempt failed, the next run is this far away, not a day. */
export const AFTER_FAILURE_MS = 3_600_000;
/** From this many failed runs in a row the line is an error (one failed day costs nothing: three months are ahead). */
export const ESCALATE_AFTER_FAILURES = 2;

export interface PartitionStore {
  ensure(monthsAhead: number): Promise<EnsuredPartitions[]>;
  purgeKeys(retentionDays: number, limit: number): Promise<number>;
  defaultRows(): Promise<DefaultPartitionRows[]>;
}

/** Milliseconds from `now` to the next `hourUtc`:00:00 UTC (a whole day when it is exactly that moment). */
export function msUntilNextHour(now: Date, hourUtc: number): number {
  const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc);
  return (at > now.getTime() ? at : at + 86_400_000) - now.getTime();
}

interface Seen {
  created: number;
  purgedKeys: number;
  purgeComplete: boolean;
  blocked: { parent: string; months: readonly string[] }[];
  defaultRows: DefaultPartitionRows[];
}

/** The code of a database error, or the name of the error: never its message, which may name a table or a value. */
function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') return error.code;
    if ('name' in error && typeof error.name === 'string') return error.name;
  }
  return 'unknown';
}

export class PartitionMaintenanceJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<boolean> | null = null;
  private stopping = false;
  private started = false;
  private failures = 0;
  private wake: (() => void) | null = null;

  constructor(private readonly deps: { store: PartitionStore; log: Logger }) {}

  /** Runs once now (the worker may have been down for days) and then every day at `PARTITION_JOB_HOUR_UTC`. */
  start(): void {
    if (this.started) throw new Error('the partition maintenance is already started');
    this.started = true;
    void this.cycle();
  }

  /** Starts no other run, ends the pause of a retry, and waits for the step in progress. */
  async stop(): Promise<boolean> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wake?.();
    if (this.running) await this.running;
    return true;
  }

  private async cycle(): Promise<void> {
    if (this.stopping) return;
    this.running = this.runOnce();
    const ok = await this.running;
    this.running = null;
    if (this.stopping) return;
    const wait = ok ? msUntilNextHour(new Date(), PARTITION_JOB_HOUR_UTC) : AFTER_FAILURE_MS;
    this.timer = setTimeout(() => void this.cycle(), wait);
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => (clearTimeout(timer), (this.wake = null), resolve());
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  /** One run with its retries. True when it ended well; false when every attempt failed (or the job was stopped). */
  async runOnce(): Promise<boolean> {
    const started = Date.now();
    const seen: Seen = {
      created: 0,
      purgedKeys: 0,
      purgeComplete: true,
      blocked: [],
      defaultRows: [],
    };
    for (let retry = 0; ; retry++) {
      try {
        await this.attempt(seen);
        if (this.stopping) return false;
        this.failures = 0;
        this.report(seen, Date.now() - started);
        return true;
      } catch (error) {
        const delay = RETRY_DELAYS_MS[retry];
        if (this.stopping) return false;
        if (delay === undefined) {
          this.failures += 1;
          const level = this.failures >= ESCALATE_AFTER_FAILURES ? 'error' : 'warn';
          this.deps.log[level]('partition_maintenance_failed', {
            ...this.numbers(seen, Date.now() - started),
            attempts: retry + 1,
            error_code: errorCodeOf(error),
          });
          return false;
        }
        await this.pause(Math.round(delay * (1 + (Math.random() * 2 - 1) * RETRY_JITTER)));
        if (this.stopping) return false;
      }
    }
  }

  private async attempt(seen: Seen): Promise<void> {
    const { store } = this.deps;
    const ensured = await store.ensure(PARTITION_MONTHS_AHEAD);
    // Added up over the attempts: what an earlier attempt made is made, and the next one will say 0.
    seen.created += ensured.reduce((sum, e) => sum + e.created, 0);
    seen.blocked = ensured
      .filter((e) => e.blockedMonths.length > 0)
      .map((e) => ({ parent: e.parent, months: e.blockedMonths }));
    seen.purgeComplete = false;
    for (let round = 0; round < PURGE_MAX_ROUNDS && !this.stopping; round++) {
      const removed = await store.purgeKeys(INBOUND_KEY_RETENTION_DAYS, PURGE_BATCH);
      seen.purgedKeys += removed;
      if (removed === 0) {
        seen.purgeComplete = true;
        break;
      }
    }
    seen.defaultRows = (await store.defaultRows()).filter((r) => r.rowsCapped > 0);
  }

  private numbers(seen: Seen, durationMs: number): LogFields {
    const sum = <T>(items: T[], count: (item: T) => number) =>
      items.reduce((total, item) => total + count(item), 0);
    return {
      created: seen.created,
      purged_keys: seen.purgedKeys,
      blocked_months_count: sum(seen.blocked, (b) => b.months.length),
      default_rows_count: sum(seen.defaultRows, (r) => r.rowsCapped),
      consecutive_failures: this.failures,
      duration_ms: durationMs,
    };
  }

  private report(seen: Seen, durationMs: number): void {
    const { log } = this.deps;
    const numbers = this.numbers(seen, durationMs);
    log[seen.purgeComplete ? 'info' : 'warn']('partition_maintenance', {
      ...numbers,
      purge_complete: seen.purgeComplete,
    });
    if (seen.blocked.length > 0) {
      const months = [...new Set(seen.blocked.flatMap((b) => b.months))].sort().join(',');
      const tables = seen.blocked.map((b) => b.parent).join(',');
      log.warn('partition_blocked', { ...numbers, tables, months });
    }
    if (seen.defaultRows.length > 0) {
      const tables = seen.defaultRows.map((r) => `${r.parent}:${r.rowsCapped}`).join(',');
      log.warn('partition_default_rows', { ...numbers, tables });
    }
  }
}
