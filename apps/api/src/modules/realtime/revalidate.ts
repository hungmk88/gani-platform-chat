import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { Logger } from '@nestjs/common';

import { errorCode } from '../database/database.service.js';
import type { AgentSocket } from './agent-events.js';
import { authenticate, type AgentContext, type AuthenticateDeps } from './handshake.js';
import { roomsFor } from './rooms.js';

// The session of a live socket checked again (realtime spec §6, R5, N94(2)): the handshake checks once, but a connection lives for
// hours. Every period, and before a subscribe or a resume when the last check is older, steps 2–5 of the handshake run again with
// a lookup that does NOT go through the per-request cache of SessionResolver (that cache would answer for ever on a socket).

/** Spec §6: how long the result of a check is trusted (SOCKET_REVALIDATE_S). */
export const REVALIDATE_DEFAULT_S = 60;

export interface RevalidateDeps extends AuthenticateDeps {
  readonly periodMs: number;
  readonly log: Pick<Logger, 'warn'>;
  readonly now?: () => number;
}

export interface CheckedSocket extends AgentSocket {
  readonly request: IncomingMessage;
  data: { ctx: AgentContext };
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(close?: boolean): unknown;
  once(event: 'disconnect', listener: () => void): unknown;
}

/** SOCKET_REVALIDATE_S: a whole number of seconds from 1 to 3600, or the default; anything else stops the start. */
export function revalidatePeriodMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env['SOCKET_REVALIDATE_S'];
  if (raw === undefined || raw === '') return REVALIDATE_DEFAULT_S * 1000;
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(seconds >= 1 && seconds <= 3600))
    throw new Error('SOCKET_REVALIDATE_S must be a whole number of seconds from 1 to 3600');
  return seconds * 1000;
}

/**
 * Starts the periodic check of one socket and returns `ensureFresh` for its handlers. A refused or failing check ends the socket
 * (`session.ended` with a code, then a disconnect), and so does another person or organisation. A change of role or workspaces moves
 * it between the rooms of the workspaces and drops the conversations it followed: the client subscribes again, under the new rights.
 */
export function watchSession(
  socket: CheckedSocket,
  deps: RevalidateDeps,
): (socket: AgentSocket) => Promise<boolean> {
  const now = deps.now ?? Date.now;
  let ended = false;
  let running: Promise<boolean> | null = null;
  const end = (code: string, traceId: string): false => {
    ended = true;
    socket.emit('session.ended', { code, traceId });
    socket.disconnect(true);
    return false;
  };
  const check = async (): Promise<boolean> => {
    const traceId = randomUUID();
    const before = socket.data.ctx;
    try {
      const result = await authenticate(deps, socket.request, traceId, now());
      if ('refused' in result) return end(result.refused, traceId);
      const after = result.ctx;
      if (after.userId !== before.userId || after.orgId !== before.orgId)
        return end('unauthorized', traceId);
      const [had, has] = [new Set(roomsFor(before)), new Set(roomsFor(after))];
      const moved =
        after.role !== before.role || had.size !== has.size || [...has].some((r) => !had.has(r));
      if (moved) {
        for (const room of [...socket.rooms])
          if ((had.has(room) && !has.has(room)) || room.startsWith('conv:'))
            void socket.leave(room);
        for (const room of has) void socket.join(room);
      }
      socket.data.ctx = after;
      return true;
    } catch (error) {
      deps.log.warn(
        `socket check failed (${error instanceof Error ? errorCode(error) : 'unknown'}) socket=${socket.id} trace=${traceId}`,
      );
      return end('service_unavailable', traceId);
    }
  };
  const once = (): Promise<boolean> => {
    if (ended) return Promise.resolve(false);
    running ??= check().finally(() => (running = null));
    return running;
  };
  const timer = setInterval(() => void once(), deps.periodMs);
  timer.unref();
  socket.once('disconnect', () => {
    ended = true;
    clearInterval(timer);
  });
  return () =>
    ended
      ? Promise.resolve(false)
      : now() - socket.data.ctx.checkedAt >= deps.periodMs
        ? once()
        : Promise.resolve(true);
}
