// #23 Dữ liệu khách (CEO 30/10): the requests on a customer's personal data (`export`, `erase`) of the company, newest first by
// cursor, from `GET /v1/privacy-requests`, a contract planned for S5 (N167). It has no filter: the screen sends none. Until the API
// serves it, the route answers 404 and the screen says it is not there yet. PR B1 records a request (`POST`). PR B2a adds what
// carrying out an `erase` (`POST …/execute`, the dialog approved 30/10) needs; the dialog itself is PR B2b. U70 does not hold it.
import type { components } from '../api/planned';

export type PrivacyRequest = components['schemas']['PrivacyRequest'];
export type PrivacyRequestPage = components['schemas']['PrivacyRequestPage'];

/** 50 = mặc định của hợp đồng (trần 100). */
export function requestsPath(cursor: string | null): string {
  const p = new URLSearchParams({ limit: '50' });
  if (cursor) p.set('cursor', cursor);
  return `/v1/privacy-requests?${p.toString()}`;
}

/** The customer as the API names them, or the words of a customer without a name. */
export const customerOf = (r: Pick<PrivacyRequest, 'customer'>): string =>
  r.customer.displayName ?? 'Khách chưa có tên';

const TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** A time of the API in Viet Nam's time, or "—" for none. */
export const timeText = (iso: string | null): string => (iso ? TIME.format(new Date(iso)) : '—');

export type PrivacyRequestCreate = components['schemas']['PrivacyRequestCreate'];

/** The reason as the contract takes it: 1–500 characters (`PrivacyRequestCreate`). */
export const MAX_REASON = 500;

export interface RequestDraft {
  readonly customerId: string;
  readonly kind: PrivacyRequest['kind'];
  readonly reason: string;
}

/** The body as the API takes it (reason trimmed), or what is wrong with the form (PR B, "Ghi nhận yêu cầu"). */
export function requestBodyOf(d: RequestDraft): PrivacyRequestCreate | string {
  const reason = d.reason.trim();
  if (!d.customerId) return 'Chọn khách đã gửi yêu cầu.';
  if (!reason) return 'Ghi lý do: lý do được lưu cùng yêu cầu.';
  if (reason.length > MAX_REASON) return `Lý do tối đa ${MAX_REASON} ký tự.`;
  return { customerId: d.customerId, kind: d.kind, reason };
}

export type PrivacyErasure = components['schemas']['PrivacyErasure'];

/** The words a person types to carry out an erase (CEO 30/10): `XOA-` and the last 6 characters of the request, upper case. */
export const confirmCodeOf = (id: string): string => `XOA-${id.slice(-6).toUpperCase()}`;

/**
 * Whether what was typed is the code (CEO 30/10, point (a)): spaces at both ends cut, case not counted; spaces inside and the
 * dash are kept as typed, so "XOA 7F3A21" or "XOA7F3A21" do not match.
 */
export const confirmMatches = (typed: string, code: string): boolean =>
  typed.trim().toUpperCase() === code.toUpperCase();

/** The customer of a request in a title: the name, or "khách chưa có tên" with the request's code (CEO 30/10, point (d)). */
export const customerTitleOf = (r: Pick<PrivacyRequest, 'id' | 'customer'>): string =>
  r.customer.displayName ?? `khách chưa có tên (yêu cầu ${confirmCodeOf(r.id).slice(4)})`;

/** What the API says it erased, in words, with its own figures (never an estimate: U70). */
export function erasedLines(e: PrivacyErasure['erased']): readonly string[] {
  return [
    e.profile ? 'Hồ sơ khách: đã xóa' : 'Hồ sơ khách: không có gì để xóa',
    `Định danh kênh đã xóa: ${e.identities}`,
    `Tin đã xóa nội dung: ${e.messagesRedacted}`,
  ];
}
