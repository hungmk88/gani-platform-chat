import { createDbPool } from '@gani/db';

import { ConfigError, readConfig } from './config.js';
import { startHttp, type WorkerHttp } from './http.js';
import { createLogger } from './logger.js';
import { createDbPartitionStore } from './maintenance/db-store.js';
import { WorkerMetrics } from './metrics.js';
import { createBullmqPublisher } from './queue/bullmq-publisher.js';
import { createDbRelayStore } from './relay/db-store.js';
import { startWorker } from './worker.js';

// The entry point: it reads the settings, builds the real ports and ties the signals to the shutdown. Nothing here is logic worth a
// unit test (the parts have their own); the kill-tests of O-5 run it for real.
const log = createLogger();

function configOrExit(): ReturnType<typeof readConfig> {
  try {
    return readConfig(process.env);
  } catch (error) {
    // The message names the variables that are wrong and never echoes a URL.
    process.stderr.write(
      `${error instanceof ConfigError ? error.message : 'invalid configuration'}\n`,
    );
    return process.exit(1);
  }
}

const config = configOrExit();
const metrics = new WorkerMetrics();
// The probes come first: a worker that cannot serve them (a port in use) does not start at all.
let http: WorkerHttp;
try {
  http = await startHttp({ ...config.http, metrics });
} catch (error) {
  log.error('worker_http_failed', { code: (error as { code?: string }).code ?? 'unknown' });
  process.exit(1);
}
log.info('worker_http_listening', { port: http.port });
const pool = createDbPool(config.databaseUrl, {
  max: config.outbox.orgParallel + 2,
  onError: (error) => log.error('db_pool_error', { error: error.name }),
});
const worker = startWorker({
  store: createDbRelayStore({ pool }),
  queue: createBullmqPublisher(config.redisUrl, log),
  pool,
  log,
  settings: config.outbox,
  maintenance: createDbPartitionStore({ pool }),
  metrics,
  http,
});
log.info('worker_started');

let stopping = false;
function onSignal(signal: string): void {
  if (stopping) return process.exit(1); // a second signal: do not wait any more
  stopping = true;
  log.info('worker_stopping', { signal });
  worker.shutdown().then(
    (clean) => process.exit(clean ? 0 : 1),
    () => process.exit(1),
  );
}
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));
