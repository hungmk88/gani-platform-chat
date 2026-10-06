import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { startConsumer, type Consumer } from './consumer.js';
import { adminPool, appPool, describeOrg, queueOf, removeOrg, seedOrg, type Pool } from './db.js';
import {
  killWorkers,
  reportOnTimeout,
  requireEnv,
  restoreValkey,
  valkeyStatus,
  workerTails,
} from './harness.js';

export interface Suite {
  readonly admin: Pool;
  readonly app: Pool;
  readonly redisUrl: string;
  /** A new organisation, removed after the test. */
  newOrg(): Promise<string>;
  /** A consumer of the queue of the organisation, closed after the test. */
  consume(org: string): Promise<Consumer>;
}

/**
 * What every kill-test needs, and the clean-up that keeps one test from poisoning the next: after each test the worker processes
 * are killed, Valkey is started if the test stopped it, the consumers are closed and the organisations removed.
 */
export function useQueueSuite(): Suite {
  let pools: { admin: Pool; app: Pool } | undefined;
  let redisUrl = '';
  const orgs: string[] = [];
  const consumers: Consumer[] = [];
  const need = (): { admin: Pool; app: Pool } => {
    if (!pools) throw new Error('the connections were not made: see the error of beforeAll');
    return pools;
  };

  beforeAll(() => {
    redisUrl = requireEnv('REDIS_URL');
    requireEnv('VALKEY_CONTAINER');
    pools = { admin: adminPool(), app: appPool() };
  });

  // What a `waitFor` that runs out of time adds to its message: the outbox of the test, Valkey, and the end of the worker logs.
  beforeEach(() => {
    reportOnTimeout(async () => {
      const lines: string[] = [];
      for (const org of orgs) lines.push(await describeOrg(need().admin, org));
      lines.push(`valkey container: ${await valkeyStatus()}`, workerTails());
      return lines.join('\n');
    });
  });

  afterEach(async () => {
    reportOnTimeout(undefined);
    await killWorkers();
    await restoreValkey(redisUrl);
    for (const consumer of consumers.splice(0)) await consumer.close();
    for (const org of orgs.splice(0)) await removeOrg(need().admin, org);
  });

  afterAll(async () => {
    await Promise.all([pools?.admin.end(), pools?.app.end()]);
  });

  return {
    get admin() {
      return need().admin;
    },
    get app() {
      return need().app;
    },
    get redisUrl() {
      return redisUrl;
    },
    async newOrg() {
      const org = await seedOrg(need().admin);
      orgs.push(org);
      return org;
    },
    async consume(org) {
      const consumer = await startConsumer(redisUrl, queueOf(org));
      consumers.push(consumer);
      return consumer;
    },
  };
}
