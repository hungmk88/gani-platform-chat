// #7 Khách hàng (J1, N165): the customers of the company, one profile for every workspace (`GET /v1/customers`). The API masks
// phones and emails for Marketing and Viewer (Phụ lục B "Che") and searches them by name only.
import type { components } from '../api/schema';
import type { Role } from '../nav';

export type Customer = components['schemas']['Customer'];
export type CustomerPage = components['schemas']['CustomerPage'];

/** Rows a page asks for (the API's default; at most 100). */
export const PAGE_SIZE = 50;
/** The longest search the API takes. */
export const MAX_QUERY = 100;

/** Every role of a company reads the list (Phụ lục B); a platform operator only through a support session (#30, later). */
export const mayReadCustomers = (role: Role | null): role is Role =>
  role !== null && role !== 'platform_operator';

/** True when the API answers this role's phones and emails masked, and searches by name only. */
export const seesMasked = (role: Role): boolean => role === 'marketing' || role === 'viewer';

/** `GET /v1/customers`: newest first, by cursor; `q` (trimmed, ≤ 100) is a part of the name or the start of a phone number. */
export function customersPath(q: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  const query = q.trim().slice(0, MAX_QUERY);
  if (query) params.set('q', query);
  if (cursor) params.set('cursor', cursor);
  return `/v1/customers?${params.toString()}`;
}

/** The name, or words for a customer nobody has named yet (a Zalo webhook carries no name, N165). */
export const nameOf = (c: Pick<Customer, 'displayName'>): string =>
  c.displayName ?? 'Khách chưa có tên';

/** A Vietnamese number as people write it (`+84912345678` → `0912 345 678`; masked `+8491*****78` → `091*****78`); others as they are. */
export function phoneText(phone: string): string {
  if (!phone.startsWith('+84')) return phone;
  const local = `0${phone.slice(3)}`;
  return /^\d{10}$/.test(local)
    ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
    : local;
}

const CHANNEL: Readonly<Record<Customer['identities'][number]['type'], string>> = {
  zalo_uid: 'Zalo OA',
};

/** The channels that know the customer, each once, in words. */
export const channelsOf = (c: Pick<Customer, 'identities'>): string[] => [
  ...new Set(c.identities.map((i) => CHANNEL[i.type])),
];

const DAY = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/** A date of the API as a day in Viet Nam (`26/10/2026`). */
export const dayOf = (iso: string): string => DAY.format(new Date(iso));
