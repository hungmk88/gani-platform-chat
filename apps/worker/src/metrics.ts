/** What the relay reports as it goes (review OPS-02). Every method is cheap and never throws. */
export interface RelayMetrics {
  /** A pass ended, well (`ok`) or with an error. */
  passEnded(ok: boolean): void;
  publishFailed(count: number): void;
  deadLettered(): void;
  queueFull(): void;
}

/** What the event consumer and its queue source report (#324: where a job goes that never reaches a handler). Cheap, never throws. */
export interface ConsumerMetrics {
  /** A handler finished a job (`ok`), or threw and BullMQ will try again. */
  jobHandled(ok: boolean): void;
  /** BullMQ took a job back from a worker that stopped renewing its lock (a killed process). */
  jobStalled(): void;
  /** BullMQ failed a job for good: a permanent error, or the last attempt. */
  jobFailed(): void;
  queuesSubscribed(count: number): void;
}

/** The state of the outbox table, totals over every live organisation (`outboxStats` of `@gani/db`, N118). */
export interface OutboxTotals {
  readonly pending: number;
  readonly oldestPendingAgeSeconds: number;
  readonly deadLetter: number;
}

/**
 * The counters of the worker, in the text format of Prometheus (Brief P4, P19). No series carries an organisation or a workspace: the
 * numbers are for the platform, a label per tenant would leak who has work and grow without bound. The state of the outbox table
 * (pending, oldest age, dead letters) is not counted here: `scrape()` reads it from the database at each scrape (outbox spec §7).
 */
export class WorkerMetrics implements RelayMetrics, ConsumerMetrics {
  private passes = 0;
  private failedPasses = 0;
  private lastPassAt: number;
  private publishFailures = 0;
  private deadLetters = 0;
  private queueFulls = 0;
  private jobsHandled = 0;
  private handlerErrors = 0;
  private lastJobAt = 0;
  private jobsStalled = 0;
  private jobsFailed = 0;
  private queues = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly outbox?: () => Promise<OutboxTotals>,
  ) {
    // Until the first pass ends, the start counts as the last sign of life.
    this.lastPassAt = now();
  }

  passEnded(ok: boolean): void {
    this.passes++;
    if (!ok) this.failedPasses++;
    this.lastPassAt = this.now();
  }

  publishFailed(count: number): void {
    this.publishFailures += count;
  }

  deadLettered(): void {
    this.deadLetters++;
  }

  queueFull(): void {
    this.queueFulls++;
  }

  jobHandled(ok: boolean): void {
    if (ok) this.jobsHandled++;
    else this.handlerErrors++;
    this.lastJobAt = this.now();
  }

  jobStalled(): void {
    this.jobsStalled++;
  }

  jobFailed(): void {
    this.jobsFailed++;
  }

  queuesSubscribed(count: number): void {
    this.queues = count;
  }

  /** Alive while the relay ended a pass (even a failed one) within `maxAgeMs`: a loop that hangs stops the passes. */
  healthy(maxAgeMs: number): boolean {
    return this.now() - this.lastPassAt <= maxAgeMs;
  }

  render(): string {
    // prettier-ignore
    const series: Series[] = [
      ['outbox_relay_passes_total', 'counter', 'Passes of the outbox relay that ended.', this.passes],
      ['outbox_relay_failed_passes_total', 'counter', 'Passes of the outbox relay that ended with an error.', this.failedPasses],
      ['outbox_relay_last_pass_timestamp_seconds', 'gauge', 'When the last pass of the outbox relay ended (or the worker started).', this.lastPassAt / 1000],
      ['outbox_publish_failures_total', 'counter', 'Events the queue refused.', this.publishFailures],
      ['outbox_dead_lettered_total', 'counter', 'Events the relay moved to dead_letter after a refused publish.', this.deadLetters],
      ['outbox_queue_full_total', 'counter', 'Organisations skipped in a pass because their queue was full or could not be asked.', this.queueFulls],
      ['event_jobs_handled_total', 'counter', 'Event jobs a handler finished.', this.jobsHandled],
      ['event_handler_errors_total', 'counter', 'Event jobs whose handler threw (BullMQ tries them again).', this.handlerErrors],
      ['event_last_job_timestamp_seconds', 'gauge', 'When the consumer last finished or failed a job (0: never).', this.lastJobAt / 1000],
      ['event_jobs_stalled_total', 'counter', 'Event jobs taken back from a worker that stopped renewing its lock.', this.jobsStalled],
      ['event_jobs_failed_total', 'counter', 'Event jobs BullMQ failed for good.', this.jobsFailed],
      ['event_queues_subscribed', 'gauge', 'Event queues the consumer takes jobs from.', this.queues],
    ];
    return format(series);
  }

  /** `render()` and the state of the outbox. A database that does not answer gives `outbox_stats_up 0`, never a failed scrape. */
  async scrape(): Promise<string> {
    if (!this.outbox) return this.render();
    let totals: OutboxTotals | null = null;
    try {
      totals = await this.outbox();
    } catch {
      // The reason is in the database's own logs; a scrape carries numbers only.
    }
    // prettier-ignore
    const series: Series[] = [
      ['outbox_stats_up', 'gauge', 'Whether the state of the outbox could be read from the database.', totals ? 1 : 0],
      ...(totals ? ([
        ['outbox_pending', 'gauge', 'Events not yet published (organisations not deleted).', totals.pending],
        ['outbox_oldest_pending_age_seconds', 'gauge', 'How long the oldest pending event has waited since it was written.', totals.oldestPendingAgeSeconds],
        ['outbox_dead_letter', 'gauge', 'Events in dead_letter, waiting for the runbook.', totals.deadLetter],
      ] as Series[]) : []),
    ];
    return this.render() + format(series);
  }
}

type Series = [name: string, type: 'counter' | 'gauge', help: string, value: number];
// prettier-ignore
const format = (series: readonly Series[]) => series.map(([name, type, help, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`).join('');
