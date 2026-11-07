import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { components } from '../api/schema';
import {
  fresh,
  lastSequence,
  messageOf,
  readAgain,
  withAgentStatus,
  withMessage,
  withSla,
  withSlaInPages,
  withState,
} from './events';

type Page = components['schemas']['MessagePage'];
const msg = (n: number) => ({
  id: `m${n}`,
  sequenceNumber: n,
  senderKind: 'customer' as const,
  senderUserId: null,
  kind: 'text' as const,
  body: `tin ${n}`,
  platformSentAt: null,
  createdAt: '2026-10-21T02:00:00Z',
});
const pages = (...nums: number[][]): InfiniteData<Page> => ({
  pages: nums.map((ns) => ({ data: ns.map(msg), nextCursor: null })),
  pageParams: nums.map(() => null),
});

describe('messageOf', () => {
  it('reads a full packet, and gives nothing for the summary without the text', () => {
    const full = {
      conversationId: 'c',
      messageId: 'm9',
      sequenceNumber: 9,
      senderKind: 'customer' as const,
      kind: 'text' as const,
      body: 'chào',
      createdAt: 't',
    };
    expect(messageOf(full)).toMatchObject({
      id: 'm9',
      sequenceNumber: 9,
      body: 'chào',
      senderUserId: null,
      platformSentAt: null,
    });
    expect(
      messageOf({ conversationId: 'c', sequenceNumber: 9, senderKind: 'customer', createdAt: 't' }),
    ).toBeNull();
  });
});

describe('withMessage', () => {
  it('puts a new message on the newest page, once', () => {
    const next = withMessage(pages([3, 2], [1]), msg(4));
    expect(next?.pages[0]?.data.map((m) => m.sequenceNumber)).toEqual([4, 3, 2]);
    expect(withMessage(next, msg(4))).toBe(next);
    expect(withMessage(next, msg(1))).toBe(next);
  });

  it('leaves a conversation not loaded alone', () => {
    expect(withMessage(undefined, msg(1))).toBeUndefined();
  });
});

describe('lastSequence', () => {
  it('is the highest number held, 0 when none', () => {
    expect(lastSequence(pages([5, 4], [2]))).toBe(5);
    expect(lastSequence(undefined)).toBe(0);
  });
});

describe('withState', () => {
  const c = {
    id: 'c',
    workspaceId: 'w',
    state: 'HUMAN_ACTIVE' as const,
    afterHoursHold: false,
    assignedUserId: 'u1',
    version: 3,
    outcome: null,
    closedAt: null,
    lastMessageAt: null,
    lastCustomerMessageAt: null,
    createdAt: 't',
    customer: null,
    channelAccountId: null,
    channel: null,
    assignee: { id: 'u1', name: 'Hà Linh' },
    lastMessagePreview: null,
    sla: null,
  };
  it('applies a newer version only', () => {
    const d = {
      conversationId: 'c',
      to: 'PENDING_CUSTOMER' as const,
      hold: false,
      version: 4,
      assignedUserId: 'u1',
    };
    expect(withState(c, d)).toMatchObject({ state: 'PENDING_CUSTOMER', version: 4 });
    expect(withState(c, { ...d, version: 3 })).toBe(c);
    expect(withState(undefined, d)).toBeUndefined();
  });

  it("never keeps the old holder's name for a new holder: the id comes first, the name with the next read", () => {
    const d = {
      conversationId: 'c',
      to: 'HUMAN_ACTIVE' as const,
      hold: false,
      version: 4,
      assignedUserId: 'u1',
    };
    expect(withState(c, d)?.assignee).toEqual({ id: 'u1', name: 'Hà Linh' });
    expect(withState(c, { ...d, assignedUserId: 'u2' })?.assignee).toEqual({
      id: 'u2',
      name: null,
    });
    expect(withState(c, { ...d, assignedUserId: null })?.assignee).toBeNull();
  });
});

describe('readAgain', () => {
  const noWait = () => Promise.resolve();
  it('tries again twice with a growing wait, and stops at the first answer', async () => {
    const waits: number[] = [];
    let calls = 0;
    const read = () => (++calls < 3 ? Promise.reject(new Error('down')) : Promise.resolve('ok'));
    await expect(readAgain(read, (ms) => (waits.push(ms), Promise.resolve()))).resolves.toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual([500, 1000]);
  });

  it('gives up quietly after three failures, so what the cache has stays', async () => {
    let calls = 0;
    const read = () => (calls++, Promise.reject(new Error('500')));
    await expect(readAgain(read, noWait)).resolves.toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe('fresh (U86: the packets without a version of their own)', () => {
  it('takes a newer packet per aggregate, drops the same one again and an older one', () => {
    const seen = new Map<string, number>();
    expect(fresh(seen, 'agent:u1', 3)).toBe(true);
    expect(fresh(seen, 'agent:u1', 3)).toBe(false);
    expect(fresh(seen, 'agent:u1', 2)).toBe(false);
    expect(fresh(seen, 'agent:u2', 1)).toBe(true);
    expect(fresh(seen, 'agent:u1', 4)).toBe(true);
  });
});

describe('withAgentStatus', () => {
  const own = { status: 'online' as const, since: 't0', reason: 'manual' as const };
  const packet = (userId: string) => ({
    userId,
    status: 'offline' as const,
    since: 't1',
    reason: 'disconnected' as const,
  });
  it('is the new status of the signed-in agent, without the userId', () => {
    expect(withAgentStatus(own, packet('me'), 'me')).toEqual({
      status: 'offline',
      since: 't1',
      reason: 'disconnected',
    });
    expect(withAgentStatus(undefined, packet('me'), 'me')).toMatchObject({ status: 'offline' });
  });
  it("leaves one's own status for a packet about someone else", () => {
    expect(withAgentStatus(own, packet('u2'), 'me')).toBe(own);
  });
});

describe('withSla, withSlaInPages', () => {
  const sla = { dueAt: '2026-11-07T03:00:00Z', pausedReason: null };
  const row = (id: string) => ({ id, state: 'HUMAN_WAITING_Q', sla: null });
  it('sets the SLA of that conversation only, null included', () => {
    expect(withSla(row('c1'), { conversationId: 'c1', sla })).toEqual({ ...row('c1'), sla });
    const other = row('c2');
    expect(withSla(other, { conversationId: 'c1', sla })).toBe(other);
    expect(withSla({ ...row('c1'), sla }, { conversationId: 'c1', sla: null })?.sla).toBeNull();
    expect(withSla(undefined, { conversationId: 'c1', sla })).toBeUndefined();
  });
  it('changes the row in the pages of a list and leaves what is not pages of rows', () => {
    const list = {
      pages: [{ data: [row('c2')] }, { data: [row('c1'), row('c3')] }],
      pageParams: [],
    };
    const next = withSlaInPages(list, { conversationId: 'c1', sla }) as typeof list;
    expect(next.pages[1]?.data[0]?.sla).toEqual(sla);
    expect(next.pages[1]?.data[1]).toBe(list.pages[1]?.data[1]);
    expect(next.pages[0]).toBe(list.pages[0]);
    expect(withSlaInPages(list, { conversationId: 'c9', sla })).toBe(list);
    const channels = { data: ['zalo'] };
    expect(withSlaInPages(channels, { conversationId: 'c1', sla })).toBe(channels);
    expect(withSlaInPages(undefined, { conversationId: 'c1', sla })).toBeUndefined();
  });
});
