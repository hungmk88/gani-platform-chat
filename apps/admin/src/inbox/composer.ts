// The reply box of an open conversation (#6, I2): who may write and what is sent, the rule of `POST …/messages` (N146), kept
// out of React so it is tested. The API still decides; this only keeps a box from being offered to be refused.
import type { InfiniteData } from '@tanstack/react-query';

import type { components } from '../api/schema';
import type { Role } from '../nav';
import type { Conversation } from './list';
import type { Message } from './messages';

type MessagePage = components['schemas']['MessagePage'];

/** The longest text the API takes (N146 (5): 1–2000 characters once trimmed; Zalo's own limit is not verified yet). */
export const MAX_TEXT = 2000;

const LEADS: readonly Role[] = ['owner', 'admin', 'manager'];
const AGENTS: readonly Role[] = ['sales', 'support'];
const HELD = new Set(['HUMAN_ACTIVE', 'PENDING_CUSTOMER']);

/** Only while a person holds it (N146 (2)); owner, admin, manager any they see, sales and support only one they hold. */
export function canReply(
  c: Pick<Conversation, 'state'> & { readonly assignedUserId: string | null },
  role: Role,
  meId: string,
): boolean {
  if (!HELD.has(c.state)) return false;
  return LEADS.includes(role) || (AGENTS.includes(role) && c.assignedUserId === meId);
}

/** The text to send, or why there is none; trimmed as the API trims it. */
export function textOf(raw: string): { ok: true; text: string } | { ok: false; problem: string } {
  const text = raw.trim();
  if (!text) return { ok: false, problem: 'Nhập nội dung tin.' };
  if (text.length > MAX_TEXT)
    return { ok: false, problem: `Tin dài quá ${MAX_TEXT} ký tự. Tách thành nhiều tin.` };
  return { ok: true, text };
}

/** Why the channel refused (422 channel_window_closed, `reason` of N146 (3)); nothing was sent and the draft stays. */
export const WINDOW_REASON: Readonly<Record<string, string>> = {
  no_customer_message: 'Khách chưa nhắn tin nào qua kênh này.',
  no_free_window: 'Kênh này không có khung gửi miễn phí.',
  window_expired: 'Đã quá thời hạn trả lời miễn phí kể từ tin cuối của khách.',
  quota_exhausted: 'Đã hết số tin được gửi trong khung này.',
  no_policy: 'Kênh chưa có chính sách gửi tin. Báo Admin.',
};

/** What the person sees of an agent's message on its way out (`deliveryStatus`, N146 (1)); a customer's has none. */
export const DELIVERY_LABEL: Readonly<Record<NonNullable<Message['deliveryStatus']>, string>> = {
  pending: 'Chờ gửi',
  sent: 'Đã gửi',
  failed: 'Gửi lỗi',
};

/** The id of a message shown before the API answers (CLAUDE.md: sending is optimistic); never sent to the API. */
export const localId = (key: string) => `local-${key}`;
export const isLocal = (m: Pick<Message, 'id'>) => m.id.startsWith('local-');

/** The message as the person sees it while it is on its way: theirs, now, last in the conversation. */
export function sendingMessage(key: string, text: string, meId: string, now: Date): Message {
  return {
    id: localId(key),
    sequenceNumber: Number.MAX_SAFE_INTEGER,
    senderKind: 'agent',
    senderUserId: meId,
    kind: 'text',
    body: text,
    platformSentAt: null,
    createdAt: now.toISOString(),
    deliveryStatus: null,
  };
}

/** The pages without the message shown before the answer: replaced by the API's on success, taken back on failure. */
export function withoutLocal(
  pages: InfiniteData<MessagePage> | undefined,
  key: string,
): InfiniteData<MessagePage> | undefined {
  if (!pages) return pages;
  const id = localId(key);
  return {
    ...pages,
    pages: pages.pages.map((p) => ({ ...p, data: p.data.filter((m) => m.id !== id) })),
  };
}
