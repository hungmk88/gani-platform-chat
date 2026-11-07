// #6 Hộp thư, ghi chú nội bộ (C6, N194, N199; CEO brief 169 P1a, P1b): who writes them, how one reads, and the note shown at once while
// it is sent (optimistic, apps/admin CLAUDE.md). Whoever sees the conversation reads its notes (the API's canSee); Owner, Admin,
// Manager write on any they see, Sales and Support on one they hold; in every state. A note never changes (N194 (1)).
import type { InfiniteData } from '@tanstack/react-query';

import type { components } from '../api/schema';
import type { Role } from '../nav';
import { timeText } from '../tickets/tickets';

export type Note = components['schemas']['ConversationNote'];
export type NotePage = components['schemas']['ConversationNotePage'];
type Pages = InfiniteData<NotePage>;

export const MAX_NOTE = 2000; // counted on the NFC form, as the API counts it (N199)

const LEADS: readonly Role[] = ['owner', 'admin', 'manager'];
const AGENTS: readonly Role[] = ['sales', 'support'];

/** The same rule as `POST …/notes`: a lead on any conversation they see, Sales and Support on one they hold. */
export const mayWriteNote = (
  c: { readonly assignedUserId: string | null },
  role: Role,
  meId: string,
): boolean => LEADS.includes(role) || (AGENTS.includes(role) && c.assignedUserId === meId);

/** One page of the notes, newest first (N194 (1)). */
export const notesPath = (id: string, cursor: string | null = null): string =>
  `/v1/conversations/${encodeURIComponent(id)}/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;

/** The note to send, or why not: trimmed, 1..2000 after NFC. */
export function noteTextOf(
  raw: string,
): { ok: true; text: string } | { ok: false; problem: string } {
  const text = raw.trim();
  if (!text) return { ok: false, problem: 'Nhập nội dung ghi chú.' };
  if (text.normalize('NFC').length > MAX_NOTE)
    return { ok: false, problem: `Ghi chú dài quá ${MAX_NOTE} ký tự.` };
  return { ok: true, text };
}

/** One note in words: who wrote it ("Bạn"; a member without a name: the end of the id), when, a reason for a transfer. */
export function noteLineOf(
  n: Note,
  meId: string,
): {
  readonly by: { readonly text: string; readonly title?: string };
  readonly at: string;
  readonly kind: string | null;
} {
  const name = n.author.name?.trim();
  return {
    by:
      n.author.id === meId
        ? { text: 'Bạn' }
        : name
          ? { text: name }
          : { text: `…${n.author.id.slice(-4)}`, title: 'Nhân viên chưa có tên' },
    at: timeText(n.createdAt),
    kind: n.kind === 'transfer_reason' ? 'Lý do chuyển' : null,
  };
}

const localId = (key: string) => `local-${key}`;
export const isLocalNote = (n: Pick<Note, 'id'>): boolean => n.id.startsWith('local-');

/** The note as its writer sees it while it is on its way: theirs, now, first. */
export const sendingNote = (
  key: string,
  body: string,
  conversationId: string,
  meId: string,
  now: Date,
): Note => ({
  id: localId(key),
  conversationId,
  kind: 'note',
  author: { id: meId, name: null },
  body,
  createdAt: now.toISOString(),
});

/** The notes with `n` first, unless it is already there. */
export function withNote(pages: Pages | undefined, n: Note): Pages | undefined {
  const [first, ...rest] = pages?.pages ?? [];
  if (!pages || !first || pages.pages.some((p) => p.data.some((x) => x.id === n.id))) return pages;
  return { ...pages, pages: [{ ...first, data: [n, ...first.data] }, ...rest] };
}

/** The notes without the one sent with `key`. */
export function withoutLocalNote(pages: Pages | undefined, key: string): Pages | undefined {
  if (!pages) return pages;
  const id = localId(key);
  return {
    ...pages,
    pages: pages.pages.map((p) => ({ ...p, data: p.data.filter((n) => n.id !== id) })),
  };
}
