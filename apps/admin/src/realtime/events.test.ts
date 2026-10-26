import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { components } from '../api/schema';
import { lastSequence, messageOf, withMessage, withState } from './events';

type Page = components['schemas']['MessagePage'];
const msg = (n: number) => ({
  id: `m${n}`,
  sequenceNumber: n,
  senderKind: 'customer' as const,
  senderUserId: null as unknown as string,
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
});
