'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { scopeKey } from '../query/keys';
import { useScope } from '../query/provider';
import { lastSequence, messageOf, withMessage, withState, type MessageCreated } from './events';
import { useRealtime } from './realtime';

interface ResumeAck {
  readonly ok: boolean;
  readonly conversation?: {
    state: string;
    hold: boolean;
    version: number;
    assignedUserId: string | null;
  };
  readonly messages?: readonly Omit<MessageCreated, 'conversationId'>[];
  readonly hasMore?: boolean;
  readonly resync?: boolean;
}
const ignore = () => undefined;

/**
 * Follows the open conversation (realtime spec §5): subscribe once connected; after every reconnection `resume` from the highest
 * message held, so a message sent while the connection was down is not missed. Only the conversation's id is sent (T3).
 */
export function useConversationRealtime(id: string) {
  const socket = useRealtime();
  const queries = useQueryClient();
  const scope = useScope();

  useEffect(() => {
    if (!socket) return;
    const messages = scopeKey(scope, 'messages', id);
    const conversation = scopeKey(scope, 'conversation', id);
    const follow = () => {
      const last = lastSequence(queries.getQueryData(messages));
      if (last === 0)
        return void socket.emit('conversation.subscribe', { conversationId: id }, ignore);
      socket.emit('resume', { conversationId: id, lastSequenceNumber: last }, (ack: ResumeAck) => {
        if (!ack.ok) return;
        if (ack.resync || ack.hasMore)
          return void queries.invalidateQueries({ queryKey: messages });
        for (const m of ack.messages ?? []) {
          const message = messageOf({ ...m, conversationId: id });
          if (message)
            queries.setQueryData(messages, (p: Parameters<typeof withMessage>[0]) =>
              withMessage(p, message),
            );
        }
        const c = ack.conversation;
        if (c)
          queries.setQueryData(conversation, (prev: Parameters<typeof withState>[0]) =>
            withState(prev, {
              conversationId: id,
              to: c.state as never,
              hold: c.hold,
              version: c.version,
              assignedUserId: c.assignedUserId,
            }),
          );
      });
    };
    if (socket.connected) follow();
    socket.on('connect', follow);
    return () => {
      socket.off('connect', follow);
      socket.emit('conversation.unsubscribe', { conversationId: id }, ignore);
    };
  }, [socket, queries, scope, id]);
}
