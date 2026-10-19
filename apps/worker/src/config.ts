/** What the worker needs to run. Read once at start: a wrong setting stops the process, it does not run half configured (N90). */
export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly outbox: {
    /** Pause between two passes when there is nothing to do. */
    readonly pollMs: number;
    /** How long a claim may be held before another relay takes it back. */
    readonly leaseSeconds: number;
    readonly batchSize: number;
    readonly maxAttempts: number;
    readonly orgsPerTick: number;
    readonly orgParallel: number;
    readonly shutdownMs: number;
    /** A queue with this many jobs waiting takes no more from its organisation until it drains (backpressure). */
    readonly queueMaxWaiting: number;
  };
  /** The worker's own HTTP endpoints (`/healthz`, `/metrics`), for the probes and the monitoring (review OPS-02). */
  readonly http: {
    /** 0: a free port the system picks (the tests); the port is logged in `worker_http_listening`. */
    readonly port: number;
    /** `/healthz` answers 503 when the relay has not ended a pass for this long: its loop is stuck. */
    readonly healthMaxAgeMs: number;
  };
}

/** Lists every wrong variable at once, by name only: a URL carries a password and is never echoed. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid worker configuration (see .env.example): ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const problems: string[] = [];
  const text = (name: string): string => {
    const value = env[name];
    if (value === undefined || value.trim() === '') problems.push(`${name} is not set`);
    return value ?? '';
  };
  const whole = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!(value >= min && value <= max)) {
      problems.push(`${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
      return fallback;
    }
    return value;
  };
  const config: WorkerConfig = {
    databaseUrl: text('DATABASE_URL_APP'),
    redisUrl: text('REDIS_URL'),
    outbox: {
      pollMs: whole('OUTBOX_POLL_MS', 500, 50, 60_000),
      leaseSeconds: whole('OUTBOX_LEASE_S', 60, 1, 3_600),
      batchSize: whole('OUTBOX_BATCH', 100, 1, 1_000),
      maxAttempts: whole('OUTBOX_MAX_ATTEMPTS', 5, 1, 20),
      // 1..1000 is what app.outbox_pending_orgs accepts (22023 otherwise).
      orgsPerTick: whole('OUTBOX_ORGS_PER_TICK', 50, 1, 1_000),
      orgParallel: whole('OUTBOX_ORG_PARALLEL', 4, 1, 32),
      shutdownMs: whole('OUTBOX_SHUTDOWN_MS', 10_000, 1_000, 120_000),
      queueMaxWaiting: whole('OUTBOX_QUEUE_MAX_WAITING', 10_000, 1, 1_000_000),
    },
    http: {
      port: whole('WORKER_HTTP_PORT', 9464, 0, 65_535),
      // A pass is short, but one over many organisations with Valkey down waits 5 s for each: 120 s leaves room for that.
      healthMaxAgeMs: whole('WORKER_HEALTH_MAX_AGE_S', 120, 10, 3_600) * 1000,
    },
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
