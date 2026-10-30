// #23 Dữ liệu khách, Đợt 1 read only (PR A, CEO 30/10): the requests on a customer's personal data (`export`, `erase`) of the company,
// newest first by cursor, from `GET /v1/privacy-requests`, a contract planned for S5 (N167). It has no filter: the screen sends
// none. Until the API serves it, the route answers 404 and the screen says it is not there yet. Recording a request and carrying
// it out wait for PR B (the erase dialog approved 30/10, U70).
import type { components } from '../api/planned';

export type PrivacyRequest = components['schemas']['PrivacyRequest'];
export type PrivacyRequestPage = components['schemas']['PrivacyRequestPage'];

/** 50 = mặc định của hợp đồng (trần 100). */
export function requestsPath(cursor: string | null): string {
  const p = new URLSearchParams({ limit: '50' });
  if (cursor) p.set('cursor', cursor);
  return `/v1/privacy-requests?${p.toString()}`;
}

export const KIND: Readonly<Record<PrivacyRequest['kind'], string>> = {
  export: 'Xuất dữ liệu',
  erase: 'Xóa dữ liệu',
};

/** The word of each status and its state colour; never told by colour alone. */
export const STATUS: Readonly<
  Record<PrivacyRequest['status'], readonly [string, 'ok' | 'error' | null]>
> = {
  pending: ['Chờ thực hiện', null],
  done: ['Đã thực hiện', 'ok'],
  failed: ['Không thực hiện được', 'error'],
};

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
