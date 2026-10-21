import { describe, expect, it } from 'vitest';

import { inReadingOrder, messagesPath, senderOf, type Message } from './messages';

const m = (
  sequenceNumber: number,
  platformSentAt: string | null,
  createdAt = '2026-10-21T05:00:00Z',
): Message => ({
  id: `m${sequenceNumber}`,
  sequenceNumber,
  senderKind: 'customer',
  senderUserId: null as unknown as string,
  kind: 'text',
  body: `tin ${sequenceNumber}`,
  platformSentAt,
  createdAt,
});

describe('inReadingOrder', () => {
  it('puts a late Zalo message where it was sent, and the pages back in time order', () => {
    const newest = [m(4, '2026-10-21T02:01:00Z'), m(3, '2026-10-21T03:00:00Z')];
    const older = [m(2, '2026-10-21T02:00:00Z'), m(1, '2026-10-21T01:00:00Z')];
    expect(inReadingOrder([newest, older]).map((x) => x.sequenceNumber)).toEqual([1, 2, 4, 3]);
  });

  it('uses the time it was stored without platformSentAt, the sequence on a tie, and keeps one of each', () => {
    const page = [
      m(3, null, '2026-10-21T01:00:00Z'),
      m(2, '2026-10-21T01:00:00Z'),
      m(2, '2026-10-21T01:00:00Z'),
    ];
    expect(inReadingOrder([page]).map((x) => x.sequenceNumber)).toEqual([2, 3]);
  });
});

describe('senderOf', () => {
  it('names the kind of sender, me for my own messages, and no made-up name', () => {
    expect(senderOf({ senderKind: 'customer', senderUserId: null }, 'u1')).toBe('Khách');
    expect(senderOf({ senderKind: 'agent', senderUserId: 'u1' }, 'u1')).toBe('Tôi');
    expect(senderOf({ senderKind: 'agent', senderUserId: 'u2' }, 'u1')).toBe('Nhân viên');
    expect(senderOf({ senderKind: 'bot', senderUserId: null }, 'u1')).toBe('Bot');
    expect(senderOf({ senderKind: 'system', senderUserId: null }, 'u1')).toBe('Hệ thống');
  });
});

describe('messagesPath', () => {
  it('asks a page, then the one before the cursor', () => {
    expect(messagesPath('c1', null)).toBe('/v1/conversations/c1/messages?limit=50');
    expect(messagesPath('c1', 'a/b')).toBe('/v1/conversations/c1/messages?limit=50&cursor=a%2Fb');
  });
});
