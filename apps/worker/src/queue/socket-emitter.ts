// The worker's side of realtime (realtime spec §1, §3): packets for the sockets of /agent, published on Valkey with
// @socket.io/redis-emitter and delivered by the redis adapter of every API instance (N144). The rest of the worker sees `AgentEmitter`.
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';

import type { AgentEmitter } from '../consumer/agent-emitter.js';
import type { Logger } from '../logger.js';
import { QUEUE_CALL_MS, QueueDownError, throttledErrorLog } from './bullmq-publisher.js';

/** The part of an ioredis connection the emitter uses. */
export interface PublishConnection {
  readonly status: string;
  publish(channel: string, message: string | Buffer): Promise<unknown>;
  once(event: 'ready', listener: () => void): unknown;
  off(event: 'ready', listener: () => void): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
}

/**
 * The emitter publishes and forgets: a failed PUBLISH would be a rejection nobody handles. Here each emit waits for its PUBLISH, in
 * bounded time and on a connection that is up, and throws QueueDownError otherwise: the job fails and BullMQ tries it again later
 * (at least once; the client drops a packet it already has, N141).
 */
export function agentEmitterOver(
  connection: PublishConnection,
  callMs = QUEUE_CALL_MS,
): AgentEmitter {
  let sent: Promise<unknown> = Promise.resolve();
  const client = {
    publish: (channel: string, message: string | Buffer) =>
      (sent = connection.publish(channel, message)),
  };
  const agent = new Emitter(client).of('/agent');
  const within = <T>(call: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new QueueDownError('Valkey did not answer in time')), callMs);
    });
    return Promise.race([call, late]).finally(() => clearTimeout(timer));
  };
  const ready = (): Promise<void> => {
    if (connection.status === 'ready') return Promise.resolve();
    let listener = (): void => undefined;
    const up = new Promise<void>((resolve) => {
      listener = resolve;
      connection.once('ready', listener);
    });
    return within(up).finally(() => connection.off('ready', listener));
  };
  return {
    async emit(rooms, event, packet) {
      await ready();
      agent.to([...rooms]).emit(event, packet);
      await within(sent);
    },
    async close() {
      if (connection.status === 'ready')
        await within(connection.quit()).catch(() => connection.disconnect());
      else connection.disconnect();
    },
  };
}

/** The emitter over a real connection to `REDIS_URL`; the address (it can hold a password) is never logged. */
export function createAgentEmitter(redisUrl: string, log: Logger): AgentEmitter {
  const connection = new Redis(redisUrl, {
    enableOfflineQueue: false,
    connectTimeout: QUEUE_CALL_MS,
    commandTimeout: QUEUE_CALL_MS,
  });
  connection.on('error', throttledErrorLog(log, Date.now));
  return agentEmitterOver(connection);
}
