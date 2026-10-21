import type { Server as HttpServer } from 'node:http';

import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { Server, type DefaultEventsMap, type Namespace } from 'socket.io';

import {
  createAgentHandshake,
  HandshakeRefusedError,
  type AgentContext,
  type HandshakeDeps,
} from './handshake.js';
import { roomsFor, userRoom } from './rooms.js';

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

  attach(
    httpServer: HttpServer,
    deps: Omit<HandshakeDeps, 'connections' | 'maxPerUser' | 'log'>,
  ): AgentNamespace {
    if (this.io) throw new Error('the realtime server is already attached');
    const io: AgentServer = (this.io = new Server(httpServer, {
      transports: ['websocket'],
      maxHttpBufferSize: SOCKET_MAX_BYTES,
      serveClient: false,
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
    });
    return agent;
  }

  /** The namespace, for the handlers of V7c and for the tests; null before `attach`. */
  get agent(): AgentNamespace | null {
    return this.io?.of('/agent') ?? null;
  }

  /** Before Nest closes the HTTP server, which would otherwise wait for the open sockets. */
  beforeApplicationShutdown(): void {
    this.io?.disconnectSockets(true);
    this.io?.engine.close();
  }
}
