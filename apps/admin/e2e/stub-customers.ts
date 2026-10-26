// #7 Khách hàng and #8 Hồ sơ khách for the e2e stub API only (N165): `GET /v1/customers` (newest first, by cursor, searched like the
// API: a part of the name, or the start of a phone number from 3 digits) and `GET /v1/customers/{id}`. Marketing and Viewer search by
// name only and get phones and emails masked. Never deployed.
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

/** Answers GET /v1/customers and /v1/customers/{id} and says true, or false for any other route; `session` is null when signed out. */
export function routeCustomers(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || !path.startsWith('/v1/customers')) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const masked = session.role === 'marketing' || session.role === 'viewer';
  const shown = (c: Customer) => ({
    ...c,
    phone: c.phone && masked ? maskPhone(c.phone) : c.phone,
    email: c.email && masked ? maskEmail(c.email) : c.email,
  });
  // #8 Hồ sơ khách: one customer; another company's or none is a 404 (P9).
  const one = /^\/v1\/customers\/([^/]+)$/.exec(path);
  if (one) {
    const c = CUSTOMERS.find((x) => x.id === decodeURIComponent(one[1] ?? ''));
    if (!c) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    return (edge.send(res, 200, shown(c)), true);
  }
  if (path !== '/v1/customers') return false;
  const query = new URL(req.url ?? '/', 'http://stub').searchParams;
  const q = query.get('q')?.trim() ?? '';
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
  const page = found.slice(from, from + CUSTOMERS_PAGE).map(shown);
  const next = from + CUSTOMERS_PAGE < found.length ? String(from + CUSTOMERS_PAGE) : null;
  edge.send(res, 200, { data: page, nextCursor: next });
  return true;
}
