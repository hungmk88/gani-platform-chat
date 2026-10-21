// A stand-in for Socket.IO /agent (realtime spec §2–5) for the e2e stub API only. The handshake checks Origin and the session
// cookie like the API; rooms come from the session, named per session here so tests running side by side never hear each other.
// Test levers (POST /__e2e/*, realtime.spec.ts) play the worker: a message, a change of state, a dropped connection, an ended session.
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

interface AgentConversation {
  readonly id: string;
  state: string;
  readonly afterHoursHold: boolean;
  version: number;
  readonly assignedUserId: string | null;
}
interface AgentMessage {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly senderKind: string;
  readonly createdAt: string;
}
export interface AgentSession {
  readonly conversations: AgentConversation[];
  readonly messages: AgentMessage[];
}
export interface Agent {
  lever(name: string, sid: string, body: Record<string, unknown>): void;
  close(): void;
}

const room = (sid: string, what: string) => `${sid}:${what}`;
const envelope = (type: string, version: number, data: object) => ({
  eventId: randomUUID(),
  type,
  aggregateVersion: version,
  data,
});

/** `withMessages`: the one conversation whose messages the stub keeps (the others have none). */
export function attachAgent(
  server: HttpServer,
  sessions: Map<string, AgentSession>,
  withMessages: string,
): Agent {
  const agent = new Server(server, { transports: ['websocket'] }).of('/agent');
  agent.use((socket, next) => {
    const sid = /(?:^|; )e2e_session=([^;]+)/.exec(socket.request.headers.cookie ?? '')?.[1];
    if (socket.request.headers.origin !== 'http://localhost:3001')
      return next(new Error('forbidden_origin'));
    if (!sid || !sessions.has(sid)) return next(new Error('unauthorized'));
    socket.data = { sid };
    next();
  });

  agent.on('connection', (socket) => {
    const { sid } = socket.data as { sid: string };
    void socket.join(room(sid, 'ws'));
    const visible = (id: unknown) => sessions.get(sid)?.conversations.find((c) => c.id === id);
    type Ack = (a: object) => void;
    socket.on(
      'conversation.subscribe',
      ({ conversationId }: { conversationId: string }, ack: Ack) => {
        if (!visible(conversationId)) return ack({ ok: false, code: 'not_found' });
        void socket.join(room(sid, `conv:${conversationId}`));
        ack({ ok: true });
      },
    );
    socket.on(
      'conversation.unsubscribe',
      ({ conversationId }: { conversationId: string }, ack: Ack) => {
        void socket.leave(room(sid, `conv:${conversationId}`));
        ack({ ok: true });
      },
    );
    socket.on(
      'resume',
      (
        {
          conversationId,
          lastSequenceNumber,
        }: { conversationId: string; lastSequenceNumber: number },
        ack: Ack,
      ) => {
        const c = visible(conversationId);
        if (!c) return ack({ ok: false, code: 'not_found' });
        void socket.join(room(sid, `conv:${conversationId}`));
        const own = c.id === withMessages ? (sessions.get(sid)?.messages ?? []) : [];
        const messages = own
          .filter((m) => m.sequenceNumber > lastSequenceNumber)
          .map(({ id, ...m }) => ({ messageId: id, ...m }));
        const { state, afterHoursHold: hold, version, assignedUserId } = c;
        ack({
          ok: true,
          conversation: { id: c.id, state, hold, version, assignedUserId },
          messages,
          hasMore: false,
          resync: false,
        });
      },
    );
  });

  function lever(name: string, sid: string, body: Record<string, unknown>) {
    const s = sessions.get(sid);
    const c = s?.conversations.find((x) => x.id === body['conversationId']);
    if (name === 'message' && s && c) {
      const n = Math.max(...s.messages.map((m) => m.sequenceNumber)) + 1;
      const m = {
        ...s.messages[0]!,
        id: `0190b000-0000-7000-8000-0000000001${n}`,
        sequenceNumber: n,
        body: String(body['body']),
        platformSentAt: null,
        createdAt: new Date().toISOString(),
      };
      s.messages.push(m);
      const { id, ...rest } = m;
      const full = { conversationId: c.id, messageId: id, ...rest };
      agent
        .to(room(sid, `conv:${c.id}`))
        .emit('message.created', envelope('message.created', c.version, full));
      // The workspace's room gets the summary, never the text (R3).
      const summary = {
        conversationId: c.id,
        sequenceNumber: n,
        senderKind: m.senderKind,
        createdAt: m.createdAt,
      };
      agent
        .to(room(sid, 'ws'))
        .emit('message.created', envelope('message.created', c.version, summary));
    }
    if (name === 'state' && c) {
      Object.assign(c, { state: body['to'], version: c.version + 1 });
      const data = {
        conversationId: c.id,
        to: c.state,
        hold: c.afterHoursHold,
        version: c.version,
        assignedUserId: c.assignedUserId,
      };
      agent
        .to([room(sid, `conv:${c.id}`), room(sid, 'ws')])
        .emit(
          'conversation.state_changed',
          envelope('conversation.state_changed', c.version, data),
        );
    }
    // Closes the transport, as a lost network does: the client reconnects by itself (a server disconnect would not).
    if (name === 'drop')
      for (const socket of agent.sockets.values())
        if (socket.rooms.has(room(sid, 'ws'))) socket.conn.close();
    if (name === 'end') {
      agent
        .to(room(sid, 'ws'))
        .emit('session.ended', { code: 'unauthorized', traceId: 'trace-e2e-ended' });
      sessions.delete(sid);
    }
  }

  return { lever, close: () => void agent.server.close() };
}
