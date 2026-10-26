// #22 Mẫu trả lời nhanh (`/settings/quick-replies`, C7, N163): the templates of the workspace being worked in, most used first
// (`GET /v1/quick-replies?workspaceId=&q=&tag=`; `q` is the start of a shortcut, `tag` one of the template's tags).
import type { components } from '../api/schema';
import type { Role } from '../nav';

export type QuickReply = components['schemas']['QuickReply'];
export type QuickReplyList = components['schemas']['QuickReplyList'];

/** Who manages the templates (Phụ lục B "Quản lý mẫu trả lời nhanh", N163); Sales and Support only use them in the Inbox. */
export const mayManageQuickReplies = (role: Role | null): boolean =>
  role === 'owner' || role === 'admin' || role === 'manager';

/** The longest start of a shortcut the API takes as `q`. */
export const MAX_QUERY = 32;

export interface QuickReplyFilter {
  readonly q: string;
  readonly tag: string | null;
}

/** The list path: `q` as typed, trimmed and lower case like a shortcut; empty parts are left out. */
export function quickRepliesPath(workspaceId: string, { q, tag }: QuickReplyFilter): string {
  const params = new URLSearchParams({ workspaceId });
  const start = q.trim().toLowerCase().slice(0, MAX_QUERY);
  if (start) params.set('q', start);
  if (tag) params.set('tag', tag);
  return `/v1/quick-replies?${params.toString()}`;
}

/** "Đã dùng 3 lần" / "Chưa dùng lần nào". */
export const usedText = (count: number): string =>
  count > 0 ? `Đã dùng ${count} lần` : 'Chưa dùng lần nào';
