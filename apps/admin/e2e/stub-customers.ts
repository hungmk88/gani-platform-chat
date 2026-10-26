// #7 Khách hàng for the e2e stub API only (N165): `GET /v1/customers`, newest first, by cursor, searched like the API (a part of the
// name, or the start of a phone number from 3 digits; Marketing and Viewer by name only, their phones and emails masked). Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Customer } from '../src/customers/customers';
import type { Edge } from './stub-members';

const zalo = {
  type: 'zalo_uid',
  channelAccountId: '0190c200-0000-7000-8000-000000000001',
  verification: 'unverified',
} as const;

/** The customers of every session's company, newest first. */
export const CUSTOMERS: Customer[] = [
  ['Nguyễn Văn An', '+84900000001', 'an@example.test', true],
  [null, null, null, true],
  ['Trần Thị Bình', '+84900000002', null, true],
  ['Lê Minh Châu', '+84910000003', 'chau@example.test', false],
].map(([displayName, phone, email, onZalo], n) => ({
  id: `0190c100-0000-7000-8000-00000000000${n + 1}`,
  displayName: displayName as string | null,
  phone: phone as string | null,
  email: email as string | null,
  humanOnly: false,
  identities: onZalo ? [zalo] : [],
  createdAt: `2026-10-2${4 - n}T03:00:00.000Z`,
  updatedAt: `2026-10-2${4 - n}T03:00:00.000Z`,
}));
/** The page size of the stub's list, small so that "Tải thêm" is tested. */
export const CUSTOMERS_PAGE = 3;

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
const maskPhone = (p: string) => `${p.slice(0, 5)}*****${p.slice(-2)}`;
const maskEmail = (e: string) => `${e[0]}***${e.slice(e.indexOf('@'))}`;

/** Answers GET /v1/customers and says true, or says false for any other route. `session` is null when signed out. */
export function routeCustomers(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/customers') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const query = new URL(req.url ?? '/', 'http://stub').searchParams;
  const q = query.get('q')?.trim() ?? '';
  const masked = session.role === 'marketing' || session.role === 'viewer';
  const digits = q.replace(/\D/g, '');
  const prefix = !masked && /^[\d\s+.-]+$/.test(q) && digits.length >= 3 ? digits : null;
  const found = CUSTOMERS.filter((c) =>
    !q
      ? true
      : prefix !== null
        ? `0${c.phone?.slice(3) ?? ''}`.startsWith(prefix) ||
          (c.phone ?? '').startsWith(`+${prefix}`)
        : fold(c.displayName ?? '').includes(fold(q)),
  );
  const from = Number(query.get('cursor') ?? 0);
  const page = found.slice(from, from + CUSTOMERS_PAGE).map((c) => ({
    ...c,
    phone: c.phone && masked ? maskPhone(c.phone) : c.phone,
    email: c.email && masked ? maskEmail(c.email) : c.email,
  }));
  const next = from + CUSTOMERS_PAGE < found.length ? String(from + CUSTOMERS_PAGE) : null;
  edge.send(res, 200, { data: page, nextCursor: next });
  return true;
}
