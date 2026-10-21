import { randomUUID } from 'node:crypto';

import {
  listMessagesAfter,
  loadConversationView,
  RESUME_PAGE_MAX,
  type ConversationView,
  type MessageView,
  type TenantContext,
  type TenantTx,
} from '@gani/db';
import type { Logger } from '@nestjs/common';
import { z } from 'zod';

import { errorCode } from '../database/database.service.js';
import { canSee } from '../conversations/permissions.js';
import { runWithRequestContext } from '../request-context/request-context.js';
import type { AgentContext } from './handshake.js';

// What a client of /agent may ask (realtime spec §3, §5): to follow a conversation, to stop, and to catch up after a reconnection.
// Each event runs in the request context of the socket and in a transaction of its tenant, with a new traceId (ADR-004). A
// conversation the person may not see is `not_found`, exactly like an id that does not exist (P9: 404, never 403).

export const convRoom = (conversationId: string): string => `conv:${conversationId}`;
/** Spec §3: rooms of conversations one socket may follow at a time. */
export const MAX_CONVERSATION_ROOMS = 20;
/** Spec §5: `resume` calls per socket in a window. */
export const RESUME_LIMIT = { calls: 10, windowMs: 10_000 } as const;

export type Ack = (answer: Record<string, unknown>) => void;

/** The part of a socket the handlers use. */
export interface AgentSocket {
  readonly id: string;
  readonly data: { ctx: AgentContext };
  readonly rooms: ReadonlySet<string>;
  join(room: string): unknown;
  leave(room: string): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface AgentEventDeps {
  withTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  /** Checks the session again when the socket's check is older than the period (spec §6); false: the socket was ended. */
  ensureFresh(socket: AgentSocket): Promise<boolean>;
  readonly log: Pick<Logger, 'warn'>;
  readonly now?: () => number;
}

const Subscribe = z.object({ conversationId: z.uuid() });
const Resume = z.object({ conversationId: z.uuid(), lastSequenceNumber: z.number().int().min(0) });

class Refusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const snapshot = (c: ConversationView) => ({
  id: c.id,
  state: c.state,
  hold: c.afterHoursHold,
  version: c.version,
  assignedUserId: c.assignedUserId,
});
const message = (m: MessageView) => ({
  messageId: m.id,
  sequenceNumber: m.sequenceNumber,
  senderKind: m.senderKind,
  senderUserId: m.senderUserId,
  kind: m.kind,
  body: m.body,
  platformSentAt: m.platformSentAt?.toISOString() ?? null,
  createdAt: m.createdAt.toISOString(),
});

export function registerAgentEvents(socket: AgentSocket, deps: AgentEventDeps): void {
  const now = deps.now ?? Date.now;
  const resumes: number[] = [];

  /** Runs `fn` for this socket's tenant and answers the ack; an ack that is not a function means nobody listens, so nothing runs. */
  const handle =
    (fn: (args: unknown, ctx: AgentContext, tx: TenantTx) => Promise<Record<string, unknown>>) =>
    (args: unknown, ack: unknown): void => {
      if (typeof ack !== 'function') return;
      const reply = ack as Ack;
      const traceId = randomUUID();
      const run = async (): Promise<void> => {
        if (!(await deps.ensureFresh(socket)))
          return reply({ ok: false, code: 'unauthorized', traceId });
        const ctx = { ...socket.data.ctx, traceId };
        const answer = await runWithRequestContext(ctx, () =>
          deps.withTenant({ orgId: ctx.orgId, workspaceIds: ctx.workspaceIds }, (tx) =>
            fn(args, ctx, tx),
          ),
        );
        reply({ ok: true, ...answer });
      };
      run().catch((error: unknown) => {
        if (error instanceof Refusal) return reply({ ok: false, code: error.code, traceId });
        deps.log.warn(
          `socket event failed (${error instanceof Error ? errorCode(error) : 'unknown'}) socket=${socket.id} trace=${traceId}`,
        );
        reply({ ok: false, code: 'internal_error', traceId });
      });
    };

  const parse = <T>(schema: z.ZodType<T>, args: unknown): T => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) throw new Refusal('validation_failed');
    return parsed.data;
  };
  const visible = async (
    tx: TenantTx,
    ctx: AgentContext,
    id: string,
  ): Promise<ConversationView> => {
    const conversation = await loadConversationView(tx, id);
    if (!conversation || !canSee(ctx.role, ctx.userId, conversation))
      throw new Refusal('not_found');
    return conversation;
  };
  const follow = (conversationId: string): void => {
    const room = convRoom(conversationId);
    const following = [...socket.rooms].filter((r) => r.startsWith('conv:')).length;
    if (!socket.rooms.has(room) && following >= MAX_CONVERSATION_ROOMS)
      throw new Refusal('rate_limited');
    void socket.join(room);
  };

  socket.on(
    'conversation.subscribe',
    handle(async (args, ctx, tx) => {
      const { conversationId } = parse(Subscribe, args);
      await visible(tx, ctx, conversationId);
      follow(conversationId);
      return {};
    }),
  );

  socket.on(
    'conversation.unsubscribe',
    handle((args) => {
      void socket.leave(convRoom(parse(Subscribe, args).conversationId));
      return Promise.resolve({});
    }),
  );

  // The order of §5 is the point: in the room BEFORE the messages are read, so a message that arrives meanwhile is sent live (and
  // maybe in the page too: the client drops what it has by sequenceNumber). Read first, then join, and it could be in neither.
  socket.on(
    'resume',
    handle(async (args, ctx, tx) => {
      const { conversationId, lastSequenceNumber } = parse(Resume, args);
      const at = now();
      while (resumes.length > 0 && (resumes[0] ?? 0) <= at - RESUME_LIMIT.windowMs) resumes.shift();
      if (resumes.length >= RESUME_LIMIT.calls) throw new Refusal('rate_limited');
      resumes.push(at);
      await visible(tx, ctx, conversationId);
      follow(conversationId);
      // Read again once in the room (read committed: each statement sees what is committed by then), for the snapshot of §5 step 3.
      const conversation = await visible(tx, ctx, conversationId);
      const page = await listMessagesAfter(tx, conversationId, {
        after: lastSequenceNumber,
        limit: RESUME_PAGE_MAX,
      });
      const resync = lastSequenceNumber > page.maxSequence;
      return {
        conversation: snapshot(conversation),
        messages: resync ? [] : page.rows.map(message),
        hasMore: !resync && page.hasMore,
        resync,
      };
    }),
  );
}
