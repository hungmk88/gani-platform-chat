import { ConversationStateMachine, MessageService } from '@gani/conversations';
import { createDbPool } from '@gani/db';

import { ConfigError, readConfig } from './config.js';
import { loggingHandlers } from './consumer/handlers.js';
import { createDbInboundStore } from './inbound/db-store.js';
import { createLogger } from './logger.js';
import { createDbPartitionStore } from './maintenance/db-store.js';
import { createBullmqPublisher } from './queue/bullmq-publisher.js';
import { createBullmqSource } from './queue/bullmq-source.js';
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
const pool = createDbPool(config.databaseUrl, {
  max: config.outbox.orgParallel + config.inbound.orgParallel + 2,
  onError: (error) => log.error('db_pool_error', { error: error.name }),
});
// The same state machine and message service as the API (N138); the warnings of the message service carry ids only.
const fsm = new ConversationStateMachine();
const messages = new MessageService(fsm, undefined, undefined, {
  warn: (line) => log.warn('message_clock_skew', { line }),
});
const worker = startWorker({
  store: createDbRelayStore({ pool }),
  queue: createBullmqPublisher(config.redisUrl, log),
  pool,
  log,
  settings: config.outbox,
  maintenance: createDbPartitionStore({ pool }),
  inbound: {
    store: createDbInboundStore({ pool, services: { fsm, messages } }),
    settings: config.inbound,
  },
  ...(config.events.enabled && {
    events: {
      source: createBullmqSource(config.redisUrl, log, config.events.concurrency),
      handlers: loggingHandlers(log),
      settings: config.events,
    },
  }),
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
