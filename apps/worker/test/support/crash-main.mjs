// A test-only entry point of the worker for the kill-test K2 (outbox spec §10): the same worker as `src/main.ts`, with the queue
// wrapped so that the process kills itself (SIGKILL) at one exact point of a pass:
//   CRASH_AT=before_publish  the batch is claimed, nothing is in the queue yet
//   CRASH_AT=after_publish   the batch is in the queue, the events are not yet marked published
// The production worker has no such switch: a build with one in it fails the scan of `no-crash-switch.spec.ts`.
//
// KEEP IN STEP WITH src/main.ts. The lines marked "same as main.ts" repeat it; whoever changes how main.ts builds the worker
// (config, pool, store, publisher, startWorker) must change them too (apps/worker/CLAUDE.md).
import process from 'node:process';

import { ConversationStateMachine, MessageService } from '@gani/conversations';
import { createDbPool } from '@gani/db';

import { readConfig } from '../../dist/config.js';
import { createDbInboundStore } from '../../dist/inbound/db-store.js';
import { startHttp } from '../../dist/http.js';
import { createLogger } from '../../dist/logger.js';
import { createDbPartitionStore } from '../../dist/maintenance/db-store.js';
import { WorkerMetrics } from '../../dist/metrics.js';
import { createBullmqPublisher } from '../../dist/queue/bullmq-publisher.js';
import { createDbOutboxStats, createDbRelayStore } from '../../dist/relay/db-store.js';
import { startWorker } from '../../dist/worker.js';

const crashAt = process.env.CRASH_AT;
if (crashAt !== 'before_publish' && crashAt !== 'after_publish') {
  process.stderr.write('CRASH_AT must be before_publish or after_publish\n');
  process.exit(2);
}

const log = createLogger(); // same as main.ts
const config = readConfig(process.env); // same as main.ts
const pool = createDbPool(config.databaseUrl, {
  max: config.outbox.orgParallel + config.inbound.orgParallel + 2,
}); // same as main.ts
const fsm = new ConversationStateMachine(); // same as main.ts
const messages = new MessageService(fsm, undefined, undefined, {
  warn: (line) => log.warn('message_clock_skew', { line }),
}); // same as main.ts
const metrics = new WorkerMetrics(Date.now, createDbOutboxStats({ pool })); // same as main.ts
const http = await startHttp({ ...config.http, metrics }); // same as main.ts (which logs and exits 1 when it cannot listen)
log.info('worker_http_listening', { port: http.port }); // same as main.ts
const publisher = createBullmqPublisher(config.redisUrl, log); // same as main.ts

/** Kills this process and never goes on: the code after the kill must not run, whatever the scheduler does. */
async function die() {
  process.kill(process.pid, 'SIGKILL');
  await new Promise(() => undefined);
}

// The one difference from main.ts: the queue is the publisher with a crash at the chosen point.
const queue = {
  waiting: (name) => publisher.waiting(name),
  close: () => publisher.close(),
  async publish(jobs) {
    if (crashAt === 'before_publish') await die();
    const result = await publisher.publish(jobs);
    await die();
    return result;
  },
};

startWorker({
  store: createDbRelayStore({ pool }),
  queue,
  pool,
  log,
  settings: config.outbox,
  maintenance: createDbPartitionStore({ pool }),
  inbound: {
    store: createDbInboundStore({ pool, services: { fsm, messages } }),
    settings: config.inbound,
  },
  metrics,
  http,
}); // same as main.ts
log.info('worker_started');
