import type { IncomingMessage } from 'node:http';

import type { MemberContext } from '@gani/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentContext } from './handshake.js';
import {
  revalidatePeriodMs,
  watchSession,
  type CheckedSocket,
  type RevalidateDeps,
} from './revalidate.js';

const ctx: AgentContext = {
  userId: 'u1',
  orgId: 'o1',
  role: 'sales',
  workspaceIds: ['w1'],
  resolvedAt: new Date(0),
  traceId: 't0',
  sessionId: 's1',
  checkedAt: 0,
};
const session = { userId: 'u1', sessionId: 's1', activeOrgId: 'o1', resolvedAt: new Date(0) };

afterEach(() => vi.useRealTimers());

function setup(
  member: MemberContext | null | Error = { role: 'sales', workspaceIds: ['w1'] },
  now = () => 100,
) {
  const events: string[] = [];
  const rooms = new Set(['org:o1', 'user:u1', 'ws:w1', 'conv:c1']);
  let onDisconnect: () => void = () => undefined;
  const socket: CheckedSocket = {
    id: 'sock',
    request: {} as IncomingMessage,
    data: { ctx },
    rooms,
    join: (room: string) => rooms.add(room),
    leave: (room: string) => rooms.delete(room),
    on: () => undefined,
    emit: (event: string, data: unknown) => void events.push(`${event} ${JSON.stringify(data)}`),
    disconnect: () => (events.push('disconnect'), onDisconnect()),
    once: (_event, listener) => (onDisconnect = listener),
  };
  const deps: RevalidateDeps = {
    sessions: { resolve: vi.fn(() => Promise.resolve(session)) },
    mustSetUp: () => Promise.resolve(false),
    organisations: () => Promise.resolve(['o1']),
    member: () => (member instanceof Error ? Promise.reject(member) : Promise.resolve(member)),
    periodMs: 1000,
    log: { warn: () => undefined },
    now,
  };
  return { socket, deps, events, rooms, ensureFresh: () => watchSession(socket, deps) };
}

describe('watchSession', () => {
  it('trusts a recent check, checks again a stale one, and keeps the rooms when nothing changed', async () => {
    const t = setup(undefined, () => 500);
    const ensure = t.ensureFresh();
    expect(await ensure(t.socket)).toBe(true);
    expect(t.deps.sessions.resolve).not.toHaveBeenCalled();
    t.socket.data.ctx = { ...ctx, checkedAt: -600 };
    expect(await ensure(t.socket)).toBe(true);
    expect(t.deps.sessions.resolve).toHaveBeenCalledOnce();
    expect(t.socket.data.ctx.checkedAt).toBe(500);
    expect([...t.rooms]).toEqual(['org:o1', 'user:u1', 'ws:w1', 'conv:c1']);
  });

  it('ends the socket whose session is gone, with a code, and answers false afterwards', async () => {
    const t = setup(null);
    t.socket.data.ctx = { ...ctx, checkedAt: -5000 };
    const ensure = t.ensureFresh();
    expect(await ensure(t.socket)).toBe(false);
    expect(t.events[0]).toMatch(
      /^session\.ended \{"code":"no_organisation","traceId":"[0-9a-f-]{36}"\}$/,
    );
    expect(t.events[1]).toBe('disconnect');
    expect(await ensure(t.socket)).toBe(false);
  });

  it('ends the socket on a failing database too (fail closed), without the cause', async () => {
    const t = setup(new Error('password authentication failed'));
    t.socket.data.ctx = { ...ctx, checkedAt: -5000 };
    expect(await t.ensureFresh()(t.socket)).toBe(false);
    expect(t.events[0]).toContain('"code":"service_unavailable"');
    expect(t.events.join()).not.toContain('password');
  });

  it('moves the socket to the rooms of its new workspaces and drops the conversations it followed', async () => {
    const t = setup({ role: 'sales', workspaceIds: ['w2'] });
    t.socket.data.ctx = { ...ctx, checkedAt: -5000 };
    expect(await t.ensureFresh()(t.socket)).toBe(true);
    expect([...t.rooms].sort()).toEqual(['org:o1', 'user:u1', 'ws:w2']);
    expect(t.socket.data.ctx.workspaceIds).toEqual(['w2']);
  });

  it('checks every period by itself, and stops when the socket disconnects', async () => {
    vi.useFakeTimers();
    const t = setup(null);
    t.ensureFresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.events).toContain('disconnect');
    const calls = vi.mocked(t.deps.sessions.resolve).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.mocked(t.deps.sessions.resolve).mock.calls.length).toBe(calls);
  });
});

describe('revalidatePeriodMs', () => {
  it('reads SOCKET_REVALIDATE_S, 60 by default, and refuses anything outside 1..3600', () => {
    expect(revalidatePeriodMs({})).toBe(60_000);
    expect(revalidatePeriodMs({ SOCKET_REVALIDATE_S: '2' })).toBe(2000);
    for (const bad of ['0', '3601', '1.5', 'x'])
      expect(() => revalidatePeriodMs({ SOCKET_REVALIDATE_S: bad })).toThrow(/SOCKET_REVALIDATE_S/);
  });
});
