'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

import { AGENT_STATUS_KEY } from '../agent-status';
import type { Conversation } from '../inbox/list';
import { getter } from '../query/fetch';
import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import {
  fresh,
  messageOf,
  readAgain,
  withAgentStatus,
  withMessage,
  withSla,
  withSlaInPages,
  withState,
  type AgentStatusChanged,
  type Assigned,
  type Envelope,
  type MessageCreated,
  type SlaChanged,
  type StateChanged,
} from './events';

type Status = 'connecting' | 'online' | 'offline' | 'back';
const RealtimeContext = createContext<Socket | null>(null);

/**
 * One Socket.IO connection to /agent for the signed-in frame (realtime spec). The server puts it in its rooms from the session;
 * the client never names a room (T3). `origin` is empty in production, where the admin and the API share one origin behind the
 * reverse proxy (N136); dev and e2e give the API's origin, since `next start` does not forward a WebSocket upgrade.
 * Mounted inside QueryProvider, keyed by the same scope: another company, a workspace or a sign-out closes it (Brief UI §2.6).
 * `me` is the signed-in person's id: a status packet about them is their own status (U86).
 */
export function RealtimeProvider({
  origin,
  me,
  children,
}: {
  origin: string;
  me: string;
  children: ReactNode;
}) {
  const queries = useQueryClient();
  const scope = useScope();
  // Made in the browser only (not while the server renders), connected by the effect below.
  const [socket] = useState(() =>
    typeof window === 'undefined'
      ? null
      : io(`${origin}/agent`, {
          transports: ['websocket'],
          withCredentials: true,
          autoConnect: false,
        }),
  );
  const [status, setStatus] = useState<Status>('connecting');
  const shown = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!socket) return;
    const list = () =>
      void queries.invalidateQueries({ queryKey: scopeKey(scope, 'conversations') });
    // The highest `aggregateVersion` seen per aggregate, for the packets of U86 (spec §3); new with each connection's scope.
    const seen = new Map<string, number>();
    const on = {
      connect: () => setStatus((s) => (s === 'offline' ? 'back' : 'online')),
      disconnect: () => setStatus('offline'),
      'session.ended': () => window.location.assign('/login'),
      'conversation.state_changed': (e: Envelope<StateChanged>) => {
        const key = scopeKey(scope, 'conversation', e.data.conversationId);
        const before = queries.getQueryData<Conversation>(key)?.assignedUserId;
        queries.setQueryData(key, (c: Parameters<typeof withState>[0]) => withState(c, e.data));
        // A new holder: their name comes with the conversation (U30), so read it again, retried (`readAgain`).
        if (
          before !== undefined &&
          e.data.assignedUserId !== null &&
          before !== e.data.assignedUserId
        )
          void readAgain(() =>
            queries.fetchQuery({
              queryKey: key,
              queryFn: getter<Conversation>(
                `/v1/conversations/${encodeURIComponent(e.data.conversationId)}`,
              ),
              staleTime: 0,
            }),
          );
        list();
      },
      'conversation.assigned': (e: Envelope<Assigned>) => {
        void queries.invalidateQueries({
          queryKey: scopeKey(scope, 'conversation', e.data.conversationId),
        });
        list();
      },
      'message.created': (e: Envelope<MessageCreated>) => {
        const m = messageOf(e.data);
        if (m)
          queries.setQueryData(
            scopeKey(scope, 'messages', e.data.conversationId),
            (p: Parameters<typeof withMessage>[0]) => withMessage(p, m),
          );
        else list();
      },
      // U86: one's own status in the top bar from the packet; the status of a team is read again (it counts the minutes "Bận").
      'agent_status.changed': (e: Envelope<AgentStatusChanged>) => {
        if (!fresh(seen, `agent:${e.data.userId}`, e.aggregateVersion)) return;
        queries.setQueryData(
          scopeKey(scope, ...AGENT_STATUS_KEY),
          (s: Parameters<typeof withAgentStatus>[0]) => withAgentStatus(s, e.data, me),
        );
        void queries.invalidateQueries({ queryKey: scopeKey(scope, 'teams', 'agent-status') });
      },
      // U86: the SLA of the conversation and of its row, from the packet; a list filtered by SLA is read again (the row may leave).
      'conversation.sla_changed': (e: Envelope<SlaChanged>) => {
        if (!fresh(seen, `sla:${e.data.conversationId}`, e.aggregateVersion)) return;
        queries.setQueryData(
          scopeKey(scope, 'conversation', e.data.conversationId),
          (c: Conversation | undefined) => withSla(c, e.data),
        );
        queries.setQueriesData({ queryKey: scopeKey(scope, 'conversations') }, (v: unknown) =>
          withSlaInPages(v, e.data),
        );
        void queries.invalidateQueries({
          queryKey: scopeKey(scope, 'conversations'),
          predicate: (q) => {
            const filter = q.queryKey[5] as { sla?: string } | undefined;
            return filter?.sla !== undefined && filter.sla !== 'all';
          },
        });
      },
    };
    for (const [name, fn] of Object.entries(on))
      socket.on(name, fn as (...args: unknown[]) => void);
    socket.connect();
    return () => {
      for (const [name, fn] of Object.entries(on))
        socket.off(name, fn as (...args: unknown[]) => void);
      socket.disconnect();
    };
  }, [socket, queries, scope, me]);

  useEffect(() => {
    if (status !== 'back') return;
    shown.current = setTimeout(() => setStatus('online'), 4000);
    return () => clearTimeout(shown.current);
  }, [status]);

  return (
    <RealtimeContext.Provider value={socket}>
      {status === 'offline' || status === 'back' ? (
        <p
          role="status"
          className={`px-4 py-2 text-12 ${status === 'offline' ? 'bg-warn-bg text-warn-text' : 'bg-ok-bg text-ok-text'}`}
        >
          {status === 'offline'
            ? 'Mất kết nối, đang nối lại… Tin mới sẽ hiện khi nối lại.'
            : 'Đã nối lại.'}
        </p>
      ) : null}
      {children}
    </RealtimeContext.Provider>
  );
}

/** The socket of the frame; null outside RealtimeProvider (a role without the Inbox has none). */
export const useRealtime = () => useContext(RealtimeContext);
