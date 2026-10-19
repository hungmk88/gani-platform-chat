/** What the relay reports as it goes (review OPS-02). Every method is cheap and never throws. */
export interface RelayMetrics {
  /** A pass ended, well (`ok`) or with an error. */
  passEnded(ok: boolean): void;
  publishFailed(count: number): void;
  deadLettered(): void;
  queueFull(): void;
}

/**
 * The counters of the worker, in the text format of Prometheus (Brief P4, P19). No series carries an organisation or a workspace: the
 * numbers are for the platform, a label per tenant would leak who has work and grow without bound. The state of the outbox table
 * (pending, oldest age, dead letters) is read from the database, not counted here.
 */
export class WorkerMetrics implements RelayMetrics {
  private passes = 0;
  private failedPasses = 0;
  private lastPassAt: number;
  private publishFailures = 0;
  private deadLetters = 0;
  private queueFulls = 0;

  constructor(private readonly now: () => number = Date.now) {
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

  /** Alive while the relay ended a pass (even a failed one) within `maxAgeMs`: a loop that hangs stops the passes. */
  healthy(maxAgeMs: number): boolean {
    return this.now() - this.lastPassAt <= maxAgeMs;
  }

  render(): string {
    // prettier-ignore
    const series: [name: string, type: 'counter' | 'gauge', help: string, value: number][] = [
      ['outbox_relay_passes_total', 'counter', 'Passes of the outbox relay that ended.', this.passes],
      ['outbox_relay_failed_passes_total', 'counter', 'Passes of the outbox relay that ended with an error.', this.failedPasses],
      ['outbox_relay_last_pass_timestamp_seconds', 'gauge', 'When the last pass of the outbox relay ended (or the worker started).', this.lastPassAt / 1000],
      ['outbox_publish_failures_total', 'counter', 'Events the queue refused.', this.publishFailures],
      ['outbox_dead_lettered_total', 'counter', 'Events the relay moved to dead_letter after a refused publish.', this.deadLetters],
      ['outbox_queue_full_total', 'counter', 'Organisations skipped in a pass because their queue was full or could not be asked.', this.queueFulls],
    ];
    // prettier-ignore
    return series.map(([name, type, help, value]) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`).join('');
  }
}
