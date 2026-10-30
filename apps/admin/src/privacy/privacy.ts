// #23 Dữ liệu khách (CEO 30/10): the requests on a customer's personal data (`export`, `erase`) of the company, newest first by
// cursor, from `GET /v1/privacy-requests`, a contract planned for S5 (N167). It has no filter: the screen sends none. Until the API
// serves it, the route answers 404 and the screen says it is not there yet. PR B1 records a request (`POST`); carrying out an
// `erase` (`POST …/execute`, the dialog approved 30/10) is PR B2.
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
