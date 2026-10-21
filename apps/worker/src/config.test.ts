import { describe, expect, it } from 'vitest';

import { ConfigError, readConfig } from './config.js';

const URLS = {
  DATABASE_URL_APP: 'postgres://app_role:secret@db/x',
  REDIS_URL: 'redis://:secret@cache:6379',
};
const problems = (env: Record<string, string | undefined>): readonly string[] => {
  try {
    readConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe('readConfig', () => {
  // prettier-ignore
  it('takes the two URLs and gives every other setting its default', () => {
    expect(readConfig(URLS)).toEqual({
      databaseUrl: URLS.DATABASE_URL_APP, redisUrl: URLS.REDIS_URL,
      outbox: { pollMs: 500, leaseSeconds: 60, batchSize: 100, maxAttempts: 5, orgsPerTick: 50, orgParallel: 4, shutdownMs: 10_000, queueMaxWaiting: 10_000 },
      http: { port: 9464, healthMaxAgeMs: 120_000 },
    });
  });

  // prettier-ignore
  it('reads each setting from its own variable', () => {
    const env = { ...URLS, OUTBOX_POLL_MS: '250', OUTBOX_LEASE_S: '30', OUTBOX_BATCH: '10', OUTBOX_MAX_ATTEMPTS: '3', OUTBOX_ORGS_PER_TICK: '7', OUTBOX_ORG_PARALLEL: '2', OUTBOX_SHUTDOWN_MS: '5000', OUTBOX_QUEUE_MAX_WAITING: '300' };
    expect(readConfig(env).outbox).toEqual({ pollMs: 250, leaseSeconds: 30, batchSize: 10, maxAttempts: 3, orgsPerTick: 7, orgParallel: 2, shutdownMs: 5000, queueMaxWaiting: 300 });
  });

  it('reads the HTTP settings, and takes port 0 (a free port)', () => {
    const env = { ...URLS, WORKER_HTTP_PORT: '0', WORKER_HEALTH_MAX_AGE_S: '30' };
    expect(readConfig(env).http).toEqual({ port: 0, healthMaxAgeMs: 30_000 });
  });

  it('treats an empty variable as not set', () => {
    expect(readConfig({ ...URLS, OUTBOX_POLL_MS: '' }).outbox.pollMs).toBe(500);
  });

  it('names every missing URL, and never prints a value', () => {
    expect(problems({})).toEqual(['DATABASE_URL_APP is not set', 'REDIS_URL is not set']);
    expect(problems({ DATABASE_URL_APP: ' ', REDIS_URL: URLS.REDIS_URL })).toEqual([
      'DATABASE_URL_APP is not set',
    ]);
    expect(() => readConfig({})).toThrowError(/see \.env\.example/);
  });

  // prettier-ignore
  it.each([
    ['OUTBOX_POLL_MS', '10'], ['OUTBOX_POLL_MS', '999999'], ['OUTBOX_LEASE_S', '0'], ['OUTBOX_BATCH', '1001'], ['OUTBOX_MAX_ATTEMPTS', '0'], ['OUTBOX_ORGS_PER_TICK', '1001'],
    ['OUTBOX_ORG_PARALLEL', '33'], ['OUTBOX_SHUTDOWN_MS', '10'], ['OUTBOX_BATCH', '1.5'], ['OUTBOX_BATCH', 'ten'], ['OUTBOX_BATCH', '-1'], ['OUTBOX_QUEUE_MAX_WAITING', '0'],
    ['WORKER_HTTP_PORT', '65536'], ['WORKER_HEALTH_MAX_AGE_S', '5'],
  ])('refuses %s = %s and says which variable and what is allowed', (name, value) => {
    const [only] = problems({ ...URLS, [name]: value });
    expect(only).toContain(`${name} must be a whole number from`);
    expect(only).toContain(`got "${value}"`);
  });

  it('reports all the wrong variables together', () => {
    expect(problems({ OUTBOX_BATCH: 'x', OUTBOX_POLL_MS: '1' })).toHaveLength(4);
  });
});
