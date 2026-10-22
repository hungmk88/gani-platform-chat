import { describe, expect, it } from 'vitest';

import { withMessage } from '../realtime/events';
import {
  canReply,
  DELIVERY_LABEL,
  isLocal,
  MAX_TEXT,
  sendingMessage,
  textOf,
  WINDOW_REASON,
  withoutLocal,
} from './composer';

const held = (state: string, assignedUserId: string | null) =>
  ({ state, assignedUserId }) as Parameters<typeof canReply>[0];

describe('canReply', () => {
  it('offers the box only while a person holds the conversation', () => {
    for (const state of ['BOT_ACTIVE', 'HUMAN_WAITING_Q', 'CLOSED'])
      expect(canReply(held(state, 'u1'), 'owner', 'u1')).toBe(false);
    expect(canReply(held('HUMAN_ACTIVE', 'u2'), 'manager', 'u1')).toBe(true);
    expect(canReply(held('PENDING_CUSTOMER', 'u2'), 'admin', 'u1')).toBe(true);
  });

  it('lets sales and support answer only the ones they hold', () => {
    expect(canReply(held('HUMAN_ACTIVE', 'u1'), 'sales', 'u1')).toBe(true);
    expect(canReply(held('HUMAN_ACTIVE', 'u2'), 'support', 'u1')).toBe(false);
  });

  it('never offers it to the roles that do not answer customers', () => {
    for (const role of ['marketing', 'viewer', 'platform_operator'] as const)
      expect(canReply(held('HUMAN_ACTIVE', 'u1'), role, 'u1')).toBe(false);
  });
});

describe('textOf', () => {
  it('trims the text as the API does', () => {
    expect(textOf('  Dạ em chào anh  \n')).toEqual({ ok: true, text: 'Dạ em chào anh' });
  });

  it('refuses an empty text and one over the limit', () => {
    expect(textOf(' \n ')).toEqual({ ok: false, problem: 'Nhập nội dung tin.' });
    expect(textOf('a'.repeat(MAX_TEXT))).toEqual({ ok: true, text: 'a'.repeat(MAX_TEXT) });
    expect(textOf('a'.repeat(MAX_TEXT + 1)).ok).toBe(false);
  });
});

describe('words', () => {
  it('names every reason of channel_window_closed and every delivery status', () => {
    expect(Object.keys(WINDOW_REASON).sort()).toEqual(
      [
        'no_customer_message',
        'no_free_window',
        'no_policy',
        'quota_exhausted',
        'window_expired',
      ].sort(),
    );
    expect(Object.keys(DELIVERY_LABEL)).toEqual(['pending', 'sent', 'failed']);
  });
});

describe('the message shown before the answer', () => {
  const at = new Date('2026-10-22T08:00:00Z');
  const pages = (data: ReturnType<typeof sendingMessage>[]) => ({
    pages: [{ data, nextCursor: null }],
    pageParams: [null],
  });

  it("is the agent's own text, marked local, after every real message", () => {
    const m = sendingMessage('k1', 'Dạ em gửi ạ', 'u1', at);
    expect(m).toMatchObject({
      senderKind: 'agent',
      senderUserId: 'u1',
      body: 'Dạ em gửi ạ',
      createdAt: at.toISOString(),
    });
    expect(isLocal(m)).toBe(true);
    expect(isLocal({ id: '0190b000-0000-7000-8000-000000000001' })).toBe(false);
    expect(m.sequenceNumber).toBeGreaterThan(1e12);
  });

  it('is taken out by its key and leaves the others', () => {
    const real = { ...sendingMessage('x', 'cũ', 'u1', at), id: 'm1', sequenceNumber: 1 };
    const shown = withMessage(pages([real]), sendingMessage('k1', 'mới', 'u1', at));
    expect(shown?.pages[0]?.data.map((m) => m.id)).toEqual(['local-k1', 'm1']);
    expect(withoutLocal(shown, 'k1')?.pages[0]?.data.map((m) => m.id)).toEqual(['m1']);
    expect(withoutLocal(shown, 'other')?.pages[0]?.data).toHaveLength(2);
    expect(withoutLocal(undefined, 'k1')).toBeUndefined();
  });
});
