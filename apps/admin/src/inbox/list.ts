// What the conversation list of the Inbox (#6) shows and asks, kept out of React so it is tested row by row.
import type { components } from '../api/schema';
import type { Role } from '../nav';

export type Conversation = components['schemas']['Conversation'];
export type ConversationState = Conversation['state'];

/** The words a person reads for a state (prototype/dot1/inbox.js), never the name of the state machine (apps/admin/CLAUDE.md). */
export const STATE_LABEL: Readonly<Record<ConversationState, string>> = {
  BOT_ACTIVE: 'Bot đang xử lý',
  HUMAN_WAITING_Q: 'Chờ nhân viên nhận',
  HUMAN_ACTIVE: 'Nhân viên đang xử lý',
  PENDING_CUSTOMER: 'Chờ khách trả lời',
  CLOSED: 'Đã đóng',
};
export const HOLD_LABEL = 'Ngoài giờ, bot đang giữ';

export type Assignee = 'any' | 'me' | 'none';
export const ASSIGNEE_LABEL: Readonly<Record<Assignee, string>> = {
  any: 'Tất cả',
  me: 'Của tôi',
  none: 'Chưa ai nhận',
};

export interface ListFilter {
  readonly assignee: Assignee;
  /** A state, `hold` (out of hours, held for the bot) or `all`. */
  readonly state: ConversationState | 'hold' | 'all';
}
export const NO_FILTER: ListFilter = { assignee: 'any', state: 'all' };

const STATES = Object.keys(STATE_LABEL) as ConversationState[];

/** The filter of the page's search params; anything unknown is dropped, never sent on. */
export function filterOf(params: URLSearchParams): ListFilter {
  const a = params.get('assignee');
  const s = params.get('state');
  return {
    assignee: a === 'me' || a === 'none' ? a : 'any',
    state:
      s === 'hold' || STATES.includes(s as ConversationState) ? (s as ListFilter['state']) : 'all',
  };
}

/** The search params of a filter for the page's URL; the default filter is an empty query. */
export function paramsOf(f: ListFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.assignee !== 'any') p.set('assignee', f.assignee);
  if (f.state !== 'all') p.set('state', f.state);
  return p;
}

/** `GET /v1/conversations` of a filter and a cursor (the API: assignee me|none|any, state, hold=true). */
export function listPath(f: ListFilter, cursor: string | null): string {
  const p = new URLSearchParams({ assignee: f.assignee, limit: '50' });
  if (f.state === 'hold') p.set('hold', 'true');
  else if (f.state !== 'all') p.set('state', f.state);
  if (cursor) p.set('cursor', cursor);
  return `/v1/conversations?${p.toString()}`;
}

/**
 * Who holds it, as the list says it: the names wait for U30, so no name is made up. `string | null` written out: the OpenAPI
 * describes this uuid as allOf[Uuid, string|null], which openapi-typescript turns into `string` and so drops the null.
 */
export function holderOf(c: { readonly assignedUserId: string | null }, meId: string): string {
  if (c.assignedUserId === null) return 'Chưa ai nhận';
  return c.assignedUserId === meId ? 'Tôi' : 'Người khác';
}

/** The one sentence and one action of an empty list (prototype #6 "Trống"). */
export function emptyOf(
  f: ListFilter,
  role: Role,
): { readonly text: string; readonly action: 'clear' | 'unassigned' | 'channels' } {
  if (f.state !== 'all' || (f.assignee !== 'any' && f.assignee !== 'me'))
    return { text: 'Không có hội thoại khớp bộ lọc.', action: 'clear' };
  if (role === 'owner' || role === 'admin')
    return { text: 'Chưa có hội thoại.', action: 'channels' };
  return { text: 'Chưa có hội thoại nào giao cho bạn.', action: 'unassigned' };
}

const TIME = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});
/** The time of the last message (or of the conversation), in Vietnam's time. */
export const whenOf = (c: Pick<Conversation, 'lastMessageAt' | 'createdAt'>) =>
  TIME.format(new Date(c.lastMessageAt ?? c.createdAt));
