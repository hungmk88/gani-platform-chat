import { describe, expect, it } from 'vitest';

import { ROLES } from '../nav';
import {
  isLocalNote,
  mayWriteNote,
  noteLineOf,
  notesPath,
  noteTextOf,
  sendingNote,
  withNote,
  withoutLocalNote,
  type Note,
} from './notes';

const note = (over: Partial<Note> = {}): Note => ({
  id: '0190c000-0000-7000-8000-000000000001',
  conversationId: 'c1',
  kind: 'note',
  author: { id: '0190f000-0000-7000-8000-00000000a1b2', name: 'Lan' },
  body: 'Khách hẹn gọi lại chiều nay.',
  createdAt: '2026-11-07T07:05:00Z',
  ...over,
});

describe('who writes a note (N194 (2))', () => {
  it('a lead on any conversation; Sales and Support only on the one they hold; Marketing and Viewer never', () => {
    const held = { assignedUserId: 'me' };
    expect(ROLES.filter((r) => mayWriteNote(held, r, 'me'))).toEqual([
      'owner',
      'admin',
      'manager',
      'sales',
      'support',
    ]);
    expect(ROLES.filter((r) => mayWriteNote({ assignedUserId: 'other' }, r, 'me'))).toEqual([
      'owner',
      'admin',
      'manager',
    ]);
    expect(ROLES.filter((r) => mayWriteNote({ assignedUserId: null }, r, 'me'))).toEqual([
      'owner',
      'admin',
      'manager',
    ]);
  });
});

describe('notesPath', () => {
  it('under the conversation, the id and the cursor encoded', () => {
    expect(notesPath('a/b')).toBe('/v1/conversations/a%2Fb/notes');
    expect(notesPath('c1', 'x&y')).toBe('/v1/conversations/c1/notes?cursor=x%26y');
  });
});

describe('noteTextOf', () => {
  it('trims; refuses nothing and more than 2000 after NFC', () => {
    expect(noteTextOf('  Gọi lại  ')).toEqual({ ok: true, text: 'Gọi lại' });
    expect(noteTextOf('   ')).toEqual({ ok: false, problem: 'Nhập nội dung ghi chú.' });
    expect(noteTextOf('a'.repeat(2000)).ok).toBe(true);
    expect(noteTextOf('a'.repeat(2001))).toEqual({
      ok: false,
      problem: 'Ghi chú dài quá 2000 ký tự.',
    });
    // "ệ" written as e + two marks (NFD) is one character after NFC: 2000 of them pass.
    expect(noteTextOf('e\u0323\u0302'.repeat(2000)).ok).toBe(true);
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

describe('the note on its way', () => {
  const pages = { pageParams: [null], pages: [{ data: [note()], nextCursor: null }] };
  const local = sendingNote('k1', 'Mới', 'c1', 'me', new Date('2026-11-07T08:00:00Z'));

  it('is mine, a note, now, and first; then gone again', () => {
    expect(local).toMatchObject({
      kind: 'note',
      author: { id: 'me' },
      body: 'Mới',
      createdAt: '2026-11-07T08:00:00.000Z',
    });
    expect(isLocalNote(local)).toBe(true);
    expect(isLocalNote(note())).toBe(false);
    const added = withNote(pages, local);
    expect(added?.pages[0]?.data.map((n) => n.body)).toEqual([
      'Mới',
      'Khách hẹn gọi lại chiều nay.',
    ]);
    expect(withoutLocalNote(added, 'k1')).toEqual(pages);
  });
  it('never twice, and nothing before the first page is read', () => {
    expect(withNote(pages, note())).toBe(pages);
    expect(withNote(undefined, local)).toBeUndefined();
  });
});
