// #22 Mẫu trả lời nhanh (`/settings/quick-replies`, C7, N163): the templates of the workspace being worked in, most used first
// (`GET /v1/quick-replies?workspaceId=&q=&tag=`; `q` is the start of a shortcut, `tag` one of the template's tags), making one
// (`POST /v1/quick-replies`), changing and ending one (`PATCH`/`DELETE /v1/quick-replies/{id}`).
import type { ApiError } from '../api/errors';
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

type QuickReplyCreate = components['schemas']['QuickReplyCreate'];
type QuickReplyChange = components['schemas']['QuickReplyChange'];

export const MAX_SHORTCUT = 32;
export const MAX_BODY = 2000;
export const MAX_TAGS = 10;
export const MAX_TAG = 30;
const SHORTCUT = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The variables of Đợt 1 (N163), in words; the Inbox fills them from the conversation. */
export const VARIABLES = [
  ['customer_name', 'Tên khách'],
  ['agent_name', 'Tên nhân viên'],
  ['company_name', 'Tên công ty'],
  ['company_phone', 'SĐT công ty'],
] as const;

/** The names between {{ and }} that are not of Đợt 1, each once, as the API reads them. */
export function unknownVariables(text: string): string[] {
  const names = [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1] ?? '');
  return [...new Set(names)].filter((n) => !VARIABLES.some(([v]) => v === n));
}

/** `{{name}}` put into `text` at `at`, and where the caret goes after it. */
export function insertVariable(
  text: string,
  at: number,
  name: string,
): { readonly text: string; readonly caret: number } {
  const token = `{{${name}}}`;
  return { text: text.slice(0, at) + token + text.slice(at), caret: at + token.length };
}

/** The tags typed with commas: trimmed, empty ones dropped, each once. */
export const tagsOf = (raw: string): string[] => [
  ...new Set(
    raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

/** The body of `POST /v1/quick-replies`, checked like the API (N163), or why it cannot be sent. */
export function quickReplyDraftOf(
  workspaceId: string,
  rawShortcut: string,
  rawBody: string,
  rawTags: string,
): QuickReplyCreate | string {
  const shortcut = rawShortcut.trim().replace(/^\//, '');
  const body = rawBody.trim();
  const tags = tagsOf(rawTags);
  if (!SHORTCUT.test(shortcut))
    return `Phím tắt gồm chữ thường không dấu, số, "-" hoặc "_", bắt đầu bằng chữ hoặc số, tối đa ${MAX_SHORTCUT} ký tự.`;
  if (!body) return 'Nhập nội dung mẫu.';
  if (body.length > MAX_BODY) return `Nội dung tối đa ${MAX_BODY} ký tự.`;
  const unknown = unknownVariables(body);
  if (unknown.length)
    return `Biến không dùng được: ${unknown.map((n) => `{{${n}}}`).join(', ')}. Chỉ chèn biến bằng các nút bên dưới ô nội dung.`;
  if (tags.length > MAX_TAGS) return `Tối đa ${MAX_TAGS} tag.`;
  if (tags.some((t) => t.length > MAX_TAG)) return `Mỗi tag tối đa ${MAX_TAG} ký tự.`;
  return { workspaceId, shortcut, body, ...(tags.length ? { tags } : {}) };
}

/** What a dialog changes, as the body of the PATCH (only what differs), or why it cannot be sent; empty: nothing changed. */
export function quickReplyChangeOf(
  r: QuickReply,
  rawShortcut: string,
  rawBody: string,
  rawTags: string,
): QuickReplyChange | string {
  const draft = quickReplyDraftOf(r.workspaceId, rawShortcut, rawBody, rawTags);
  if (typeof draft === 'string') return draft;
  const tags = draft.tags ?? [];
  const sameTags = tags.length === r.tags.length && tags.every((t, i) => t === r.tags[i]);
  return {
    ...(draft.shortcut !== r.shortcut ? { shortcut: draft.shortcut } : {}),
    ...(draft.body !== r.body ? { body: draft.body } : {}),
    ...(sameTags ? {} : { tags }),
  };
}

export type QuickReplyPreview = components['schemas']['QuickReplyPreview'];

/** `POST /v1/quick-replies/{id}/preview` (C7c3, N163): the template with a sample customer, the reader's name, the company's name and number. */
export const previewPath = (id: string) => `/v1/quick-replies/${encodeURIComponent(id)}/preview`;

/** `POST /v1/quick-replies/preview` (U38): a template not saved yet, `{workspaceId, body}`, with the same sample values; writes nothing. */
export const DRAFT_PREVIEW_PATH = '/v1/quick-replies/preview';

/** Where each value of a variable left in a preview comes from, said to whoever manages templates. */
const MISSING: Readonly<Record<string, string>> = {
  agent_name: 'Tên nhân viên: tên của bạn đang trống, đặt ở Hồ sơ cá nhân.',
  company_name: 'Tên công ty: chưa có.',
  company_phone:
    'SĐT công ty: workspace chưa đặt SĐT liên hệ (Cài đặt › Workspace, Owner hoặc Admin).',
  customer_name: 'Tên khách: chưa có.',
};

/** The variables a preview left as written, each in words; in the Inbox the person sending fills them. */
export const missingOf = (unresolved: readonly string[]): string[] =>
  unresolved.map((n) => MISSING[n] ?? `{{${n}}}: không điền được.`);

/** The refusals of the template routes in words of the screen. */
export function quickReplyError(error: ApiError, shortcut: string): string {
  if (error.code === 'duplicate_resource')
    return `Workspace đã có mẫu khác dùng phím tắt /${shortcut}. Chọn phím tắt khác.`;
  if (error.code === 'forbidden') return 'Chỉ Owner, Admin hoặc Manager quản lý mẫu trả lời.';
  if (error.code === 'not_found')
    return 'Không tìm thấy mẫu hoặc workspace này (có thể vừa bị xóa). Tải lại trang rồi thử lại.';
  if (error.code === 'validation_failed')
    return 'Máy chủ không nhận mẫu này: kiểm lại phím tắt, nội dung, biến và tag.';
  return error.message;
}
