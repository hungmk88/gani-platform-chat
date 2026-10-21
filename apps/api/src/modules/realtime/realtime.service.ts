import type { Server as HttpServer } from 'node:http';

import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { Server, type DefaultEventsMap, type Namespace } from 'socket.io';

import type { SessionResolver } from '../request-context/session-resolver.js';

import {
  createAgentHandshake,
  HandshakeRefusedError,
  type AgentContext,
  type HandshakeDeps,
} from './handshake.js';
import { registerAgentEvents, type AgentEventDeps } from './agent-events.js';
import { watchSession } from './revalidate.js';
import { roomsFor, userRoom } from './rooms.js';
import { createValkeyLink, type AdapterPolicy, type ValkeyLink } from './valkey.js';

/** Spec §1: the client sends acks and small arguments only. */
export const SOCKET_MAX_BYTES = 64 * 1024;
/** Spec §7: sockets of one person on one instance (several tabs). */
export const SOCKETS_PER_USER = 5;

/** What the server keeps on a socket of /agent: the context its handshake decided. */
export interface AgentSocketData {
  ctx: AgentContext;
}
type AgentServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, AgentSocketData>;
export type AgentNamespace = Namespace<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  AgentSocketData
>;

/**
 * Socket.IO attached straight to the HTTP server of the application (R7, N142): no Nest gateway. WebSocket only, so no sticky session
 * (spec §1); no connection state recovery, since `resume` is explicit. Only /agent exists: the main namespace refuses everyone.
 */
@Injectable()
export class RealtimeService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Realtime');
  private io: AgentServer | null = null;
  private valkey: ValkeyLink | null = null;

  attach(
    httpServer: HttpServer,
    deps: Omit<HandshakeDeps, 'connections' | 'maxPerUser' | 'log'> & {
      /** The session looked up past the per-request cache, for the periodic check (spec §6). */
      readonly freshSessions: Pick<SessionResolver, 'resolveFresh'>;
      readonly withTenant: AgentEventDeps['withTenant'];
      readonly revalidateMs: number;
      /** Valkey, so that the packets of the worker and of the other instances reach these sockets (N144). */
      readonly adapter: AdapterPolicy;
    },
  ): AgentNamespace {
    if (this.io) throw new Error('the realtime server is already attached');
    if ('url' in deps.adapter) this.valkey = createValkeyLink(deps.adapter.url, this.logger);
    else
      this.logger.warn(
        'REDIS_URL is not set: realtime runs in memory, the worker cannot reach these sockets',
      );
    const io: AgentServer = (this.io = new Server(httpServer, {
      transports: ['websocket'],
      maxHttpBufferSize: SOCKET_MAX_BYTES,
      serveClient: false,
      ...(this.valkey ? { adapter: this.valkey.adapter } : {}),
    }));
    io.of('/').use((_socket, next) => next(new HandshakeRefusedError('unauthorized', '')));
    const agent = io.of('/agent');
    agent.use(
      createAgentHandshake({
        ...deps,
        log: this.logger,
        maxPerUser: SOCKETS_PER_USER,
        connections: async (userId) => (await agent.in(userRoom(userId)).fetchSockets()).length,
      }),
    );
    agent.on('connection', (socket) => {
      void socket.join(roomsFor(socket.data.ctx));
      const ensureFresh = watchSession(socket, {
        ...deps,
        sessions: { resolve: (req) => deps.freshSessions.resolveFresh(req) },
        periodMs: deps.revalidateMs,
        log: this.logger,
      });
      registerAgentEvents(socket, { withTenant: deps.withTenant, ensureFresh, log: this.logger });
    });
    return agent;
  }

  /** The namespace, for the tests; null before `attach`. */
  get agent(): AgentNamespace | null {
    return this.io?.of('/agent') ?? null;
  }

  /** For /readyz: Valkey answers, when the server uses it; true on the in-memory adapter. */
  ping(): Promise<boolean> {
    return this.valkey ? this.valkey.ping() : Promise.resolve(true);
  }

  /** Before Nest closes the HTTP server, which would otherwise wait for the open sockets; then the connections to Valkey. */
  async beforeApplicationShutdown(): Promise<void> {
    this.io?.disconnectSockets(true);
    this.io?.engine.close();
    await this.valkey?.close();
  }
}
