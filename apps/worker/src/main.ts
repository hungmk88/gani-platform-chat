import {
  ChannelPolicyService,
  ConversationStateMachine,
  MessageService,
} from '@gani/conversations';
import { createDbPool, withTenant } from '@gani/db';
import { installCrashHandlers, redactPii } from '@gani/domain';

import { createDbRefreshStore } from './channels/db-store.js';
import { createTokenRefresher } from './channels/refresher.js';
import { ConfigError, readConfig } from './config.js';
import { realtimeHandlers } from './consumer/realtime-handlers.js';
import { createBotTurn } from './inbound/bot-turn.js';
import { createDbInboundStore } from './inbound/db-store.js';
import { startHttp, type WorkerHttp } from './http.js';
import { createLogger } from './logger.js';
import { createDbPartitionStore } from './maintenance/db-store.js';
import { WorkerMetrics } from './metrics.js';
import { createBullmqPublisher } from './queue/bullmq-publisher.js';
import { createBullmqSource } from './queue/bullmq-source.js';
import { createAgentEmitter } from './queue/socket-emitter.js';
import { createDbOutboxStats, createDbRelayStore } from './relay/db-store.js';
import { startWorker } from './worker.js';

// The entry point: it reads the settings, builds the real ports and ties the signals to the shutdown. Nothing here is logic worth a
// unit test (the parts have their own); the kill-tests of O-5 run it for real.
const log = createLogger();
// A crash is one JSON line of `describeError` (never the error object, whose PostgreSQL `detail` holds values), then exit 1.
installCrashHandlers((line) => log.error('worker_crashed', { error: line }));

function configOrExit(): ReturnType<typeof readConfig> {
  try {
    return readConfig(process.env);
  } catch (error) {
    // The message names the variables that are wrong and never echoes a URL.
    process.stderr.write(
      `${error instanceof ConfigError ? redactPii(error.message) : 'invalid configuration'}\n`,
    );
    return process.exit(1);
  }
}

const config = configOrExit();
// The pool connects on its first query: making it before the HTTP endpoints only lets /metrics read the outbox through it.
const pool = createDbPool(config.databaseUrl, {
  max:
    config.outbox.orgParallel +
    config.inbound.orgParallel +
    config.refresh.orgParallel +
    config.events.concurrency +
    2,
  onError: (error) => log.error('db_pool_error', { error: error.name }),
});
// The same state machine and message service as the API (N138); the warnings of the message service carry ids only.
const fsm = new ConversationStateMachine();
const messages = new MessageService(fsm, undefined, undefined, {
  warn: (line) => log.warn('message_clock_skew', { line }),
});
const metrics = new WorkerMetrics(Date.now, createDbOutboxStats({ pool }));
// The probes come first: a worker that cannot serve them (a port in use) does not start at all.
let http: WorkerHttp;
try {
  http = await startHttp({ ...config.http, metrics });
} catch (error) {
  log.error('worker_http_failed', { code: (error as { code?: string }).code ?? 'unknown' });
  process.exit(1);
}
log.info('worker_http_listening', { port: http.port });
// The packets of realtime (V8b): only with the consumer, whose handlers send them.
const emitter = config.events.enabled ? createAgentEmitter(config.redisUrl, log) : null;
// The renewal of the channel tokens (B2, N173): only when turned on and given the platform client, which comes with B2-3 (Q6).
const refresher = config.refresh.enabled ? createTokenRefresher() : null;
const worker = startWorker({
  store: createDbRelayStore({ pool }),
  queue: createBullmqPublisher(config.redisUrl, log),
  pool,
  log,
  settings: config.outbox,
  maintenance: createDbPartitionStore({ pool }),
  inbound: {
    store: createDbInboundStore({
      pool,
      services: {
        fsm,
        messages,
        // The scripted bot's turn on each message (D1b3a).
        bot: createBotTurn({ fsm, messages, policy: new ChannelPolicyService(), log }),
      },
    }),
    settings: config.inbound,
  },
  ...(refresher && {
    refresh: {
      store: createDbRefreshStore({ pool }),
      refresher,
      settings: config.refresh,
      metrics,
    },
  }),
  ...(emitter && {
    events: {
      source: createBullmqSource(config.redisUrl, log, config.events.concurrency, metrics),
      handlers: realtimeHandlers({
        emitter,
        read: (tenant, fn) => withTenant(pool, tenant, fn),
        log,
      }),
      settings: config.events,
      emitter,
      metrics,
    },
  }),
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
