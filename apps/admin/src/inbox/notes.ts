// #6 Hộp thư, ghi chú nội bộ (C6, N194; CEO brief 169 P1a): how one note reads. Whoever sees the conversation reads its notes
// (the API's canSee: Sales and Support their own and the unclaimed ones); writing them is P1b. A note never changes (N194 (1)).
import type { components } from '../api/schema';
import { timeText } from '../tickets/tickets';

export type Note = components['schemas']['ConversationNote'];
export type NotePage = components['schemas']['ConversationNotePage'];
/** One page of the notes, newest first (N194 (1)). */
export const notesPath = (id: string, cursor: string | null = null): string =>
  `/v1/conversations/${encodeURIComponent(id)}/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;

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
