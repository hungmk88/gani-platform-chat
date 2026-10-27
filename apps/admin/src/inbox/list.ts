// What the conversation list of the Inbox (#6) shows and asks, kept out of React so it is tested row by row.
import type { components } from '../api/schema';
import { nameOf } from '../customers/customers';
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

/** `GET /v1/conversations` of a filter and a cursor in the workspace being worked in (the API: assignee me|none|any, state, hold=true). */
export function listPath(f: ListFilter, cursor: string | null, workspaceId: string | null): string {
  const p = new URLSearchParams({ assignee: f.assignee, limit: '50' });
  if (workspaceId) p.set('workspaceId', workspaceId);
  if (f.state === 'hold') p.set('hold', 'true');
  else if (f.state !== 'all') p.set('state', f.state);
  if (cursor) p.set('cursor', cursor);
  return `/v1/conversations?${p.toString()}`;
}

/**
 * Who holds it, in words (U30, N169, issue #373): "Tôi", their name, or "Chưa ai nhận". A holder with no name (one who left, or
 * never set one) is the last 4 characters of their id, with a tooltip: no /v1/members to fill it in. Every role that reads
 * conversations sees this: Sales/Support read only their own or unclaimed ones (API `canSee`, N133), so they only ever see
 * themselves or nobody; if that scope widens to a team after S4, look at this again. The name counts only for the id it came
 * with: after a realtime change of holder the cache has the new id before it has the new name (`withState`).
 */
export function holderOf(
  c: Pick<Conversation, 'assignee'> & { readonly assignedUserId: string | null },
  meId: string,
): { readonly text: string; readonly title?: string } {
  const id = c.assignedUserId;
  if (id === null) return { text: 'Chưa ai nhận' };
  if (id === meId) return { text: 'Tôi' };
  const name = c.assignee?.id === id ? c.assignee.name?.trim() : null;
  return name ? { text: name } : { text: `…${id.slice(-4)}`, title: 'Nhân viên chưa có tên' };
}

const CHANNEL: Readonly<Record<NonNullable<Conversation['channel']>['type'], string>> = {
  zalo_oa: 'Zalo OA',
  facebook: 'Facebook',
  webchat: 'Webchat',
};

/** The channel of the row, or null to show nothing (a conversation whose channel the API does not give). */
export const channelOf = (c: Pick<Conversation, 'channel'>): string | null =>
  c.channel ? `${CHANNEL[c.channel.type]} · ${c.channel.displayName}` : null;

/** The customer of the conversation (U30 part, N165): its name, or words for one not named or not linked yet. */
export const customerNameOf = (c: Pick<Conversation, 'customer'>): string =>
  nameOf({ displayName: c.customer?.displayName?.trim() || null });

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
