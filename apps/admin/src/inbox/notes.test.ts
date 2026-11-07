import { describe, expect, it } from 'vitest';

import { noteLineOf, notesPath, type Note } from './notes';

const note = (over: Partial<Note> = {}): Note => ({
  id: '0190c000-0000-7000-8000-000000000001',
  conversationId: 'c1',
  kind: 'note',
  author: { id: '0190f000-0000-7000-8000-00000000a1b2', name: 'Lan' },
  body: 'Khách hẹn gọi lại chiều nay.',
  createdAt: '2026-11-07T07:05:00Z',
  ...over,
});

describe('notesPath', () => {
  it('under the conversation, the id and the cursor encoded', () => {
    expect(notesPath('a/b')).toBe('/v1/conversations/a%2Fb/notes');
    expect(notesPath('c1', 'x&y')).toBe('/v1/conversations/c1/notes?cursor=x%26y');
  });
});

describe('noteLineOf', () => {
  it('who wrote it, when (Viet Nam time), and a reason for a transfer', () => {
    expect(noteLineOf(note(), 'me')).toEqual({
      by: { text: 'Lan' },
      at: '14:05 07/11/2026',
      kind: null,
    });
    expect(noteLineOf(note({ kind: 'transfer_reason' }), 'me').kind).toBe('Lý do chuyển');
  });
  it('mine says "Bạn"; a member without a name: the end of the id', () => {
    expect(noteLineOf(note(), '0190f000-0000-7000-8000-00000000a1b2').by).toEqual({ text: 'Bạn' });
    expect(noteLineOf(note({ author: { id: 'u-00ff', name: ' ' } }), 'me').by).toEqual({
      text: '…00ff',
      title: 'Nhân viên chưa có tên',
    });
  });
});
