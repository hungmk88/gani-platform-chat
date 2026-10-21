import type { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

// The Valkey link of the realtime server (realtime spec §1, N144): with it, the packets the worker emits (@socket.io/redis-emitter)
// and those of the other instances of the API reach the sockets of this one. Without it, the server only knows its own sockets.

/** How long a readiness check waits for Valkey. */
export const VALKEY_PING_MS = 2000;
const ERROR_LOG_EVERY_MS = 30_000;

export type AdapterPolicy = { readonly url: string } | { readonly memory: true };

/**
 * REDIS_URL set: the Valkey adapter. Not set: a production API refuses to start (realtime would be silently dead for every packet of
 * the worker); development and test run on the in-memory adapter, with a warning (decided 21/10/2026, N144).
 */
export function realtimeAdapterPolicy(
  env: Readonly<Record<string, string | undefined>>,
): AdapterPolicy {
  const url = env['REDIS_URL']?.trim();
  if (url) return { url };
  if (env['APP_ENV'] === 'production')
    throw new Error(
      'REDIS_URL is not set: a production API needs Valkey for its realtime server (N144)',
    );
  return { memory: true };
}

export interface ValkeyLink {
  readonly adapter: ReturnType<typeof createAdapter>;
  /** True when Valkey answers PING in time; never throws. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Two connections, one to publish and one to subscribe, as the adapter needs. The URL (it can hold a password) is never logged. */
export function createValkeyLink(
  url: string,
  log: Pick<Logger, 'warn'>,
  pingMs = VALKEY_PING_MS,
): ValkeyLink {
  let last = Number.NEGATIVE_INFINITY;
  const onError = (error: unknown): void => {
    if (Date.now() - last < ERROR_LOG_EVERY_MS) return;
    last = Date.now();
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    log.warn(`valkey connection error (${typeof code === 'string' ? code : 'unknown'})`);
  };
  const pub = new Redis(url, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  pub.on('error', onError);
  sub.on('error', onError);
  return {
    adapter: createAdapter(pub, sub),
    async ping() {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<false>(
        (resolve) => (timer = setTimeout(() => resolve(false), pingMs)),
      );
      const answer = pub.ping().then(
        (reply) => reply === 'PONG',
        () => false,
      );
      const result = await Promise.race([answer, late]);
      clearTimeout(timer);
      return result;
    },
    // QUIT on a connection that is not up waits in the offline queue for ever: such a connection is dropped instead.
    async close() {
      for (const client of [sub, pub])
        if (client.status === 'ready') await client.quit().catch(() => client.disconnect());
        else client.disconnect();
    },
  };
}
