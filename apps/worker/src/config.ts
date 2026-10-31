import type { ChannelRefreshSettings } from './channels/token-refresh.js';

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
  /** The processing of stored webhooks (inbound spec §2): the same shape as the relay, a small batch per workspace. */
  readonly inbound: {
    readonly pollMs: number;
    readonly leaseSeconds: number;
    /** Events claimed from one workspace before the next workspace gets its turn. */
    readonly batchSize: number;
    readonly maxAttempts: number;
    readonly orgsPerTick: number;
    readonly orgParallel: number;
  };
  /** The consumer of the event queues (outbox spec §5–6, N141). Off in the kill-tests of the relay, which consume the queues themselves. */
  readonly events: {
    readonly enabled: boolean;
    /** How often the registry of the queues is read for new ones. */
    readonly discoveryMs: number;
    /** Each queue holds one blocking connection to Valkey: past this many, new queues are passed over with a warning. */
    readonly maxQueues: number;
    /** Jobs of one queue run at the same time. */
    readonly concurrency: number;
  };
  /** The renewal of the channel tokens (zalo-channel spec §4, B2, N173): off until the platform client exists (B2-3, Q6). */
  readonly refresh: ChannelRefreshSettings & { readonly enabled: boolean };
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
    inbound: {
      pollMs: whole('INBOUND_POLL_MS', 500, 50, 60_000),
      leaseSeconds: whole('INBOUND_LEASE_S', 60, 1, 3_600),
      batchSize: whole('INBOUND_BATCH', 10, 1, 1_000),
      // 5 is the number of Phụ lục #14 (inbound spec §2).
      maxAttempts: whole('INBOUND_MAX_ATTEMPTS', 5, 1, 20),
      // 1..1000 is what app.inbound_pending_orgs accepts (22023 otherwise).
      orgsPerTick: whole('INBOUND_ORGS_PER_TICK', 50, 1, 1_000),
      orgParallel: whole('INBOUND_ORG_PARALLEL', 2, 1, 32),
    },
    events: {
      enabled: whole('EVENTS_CONSUMER_ENABLED', 1, 0, 1) === 1,
      discoveryMs: whole('EVENTS_DISCOVERY_MS', 5_000, 100, 60_000),
      maxQueues: whole('EVENTS_MAX_QUEUES', 200, 1, 10_000),
      concurrency: whole('EVENTS_CONCURRENCY', 4, 1, 64),
    },
    refresh: {
      enabled: whole('CHANNEL_REFRESH_ENABLED', 0, 0, 1) === 1,
      pollMs: whole('CHANNEL_REFRESH_POLL_MS', 30_000, 1_000, 600_000),
      // An access token that expires within this many seconds is renewed.
      beforeSeconds: whole('CHANNEL_REFRESH_BEFORE_S', 600, 0, 86_400),
      leaseSeconds: whole('CHANNEL_REFRESH_LEASE_S', 120, 1, 3_600),
      timeoutMs: whole('CHANNEL_REFRESH_TIMEOUT_MS', 15_000, 1_000, 120_000),
      // A failed account whose token expires within this many seconds is marked token_expiring.
      warnSeconds: whole('CHANNEL_REFRESH_WARN_S', 86_400, 0, 2_592_000),
      // 1..1000 is what app.channel_refresh_due_orgs accepts (22023 otherwise).
      orgsPerTick: whole('CHANNEL_REFRESH_ORGS_PER_TICK', 50, 1, 1_000),
      orgParallel: whole('CHANNEL_REFRESH_ORG_PARALLEL', 1, 1, 32),
    },
    http: {
      port: whole('WORKER_HTTP_PORT', 9464, 0, 65_535),
      // A pass is short, but one over many organisations with Valkey down waits 5 s for each: 120 s leaves room for that.
      healthMaxAgeMs: whole('WORKER_HEALTH_MAX_AGE_S', 120, 10, 3_600) * 1000,
    },
  };
  const { refresh } = config;
  // A claim taken back while its call still runs gets the account refreshed twice, and a refresh token may be good for one use only.
  if (refresh.leaseSeconds * 1000 < 2 * refresh.timeoutMs) {
    problems.push(
      `CHANNEL_REFRESH_LEASE_S × 1000 must be at least 2 × CHANNEL_REFRESH_TIMEOUT_MS, got ${refresh.leaseSeconds} s and ${refresh.timeoutMs} ms`,
    );
  }
  if (refresh.enabled) {
    problems.push(
      'CHANNEL_REFRESH_ENABLED=1 needs the Zalo token client (B2-3, Q6), not built yet',
    );
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
