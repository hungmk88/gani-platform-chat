// #7 Khách hàng and #8 Hồ sơ khách for the e2e stub API only (N165): `GET /v1/customers` (newest first, by cursor, searched like the
// API: a part of the name, or the start of a phone number from 3 digits), `GET /v1/customers/{id}` and `PATCH` (each session changes its
// own copy). Marketing and Viewer search by name only, get phones and emails masked and change nothing. Never deployed.
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

const edited = new Map<string, Map<string, Customer>>(); // session → the customers it changed

/** A phone the way the API stores it (`toE164` of @gani/domain), or null. */
function e164(input: string): string | null {
  const raw = input.replace(/[\s.\-()]/g, '');
  const d = !/^\+?[0-9]+$/.test(raw)
    ? null
    : raw.startsWith('+')
      ? raw.slice(1)
      : raw.startsWith('00')
        ? raw.slice(2)
        : raw.startsWith('0')
          ? `84${raw.slice(1)}`
          : raw.startsWith('84')
            ? raw
            : null;
  return d && /^[1-9][0-9]{7,14}$/.test(d) ? `+${d}` : null;
}

/** The change of a PATCH body as the API checks it (strict, at least one field, null clears), or null when it is refused (400). */
function changeOf(body: Record<string, unknown>): Partial<Customer> | null {
  const keys = Object.keys(body);
  if (!keys.length || keys.some((k) => !['displayName', 'phone', 'email', 'humanOnly'].includes(k)))
    return null;
  const text = (v: unknown, max: number) =>
    v === null
      ? null
      : typeof v === 'string' && v.trim() && v.trim().length <= max
        ? v.trim()
        : undefined;
  const change: Partial<Customer> = {};
  if ('displayName' in body) {
    const name = text(body['displayName'], 200);
    if (name === undefined) return null;
    change.displayName = name;
  }
  if ('phone' in body) {
    const phone = text(body['phone'], 32);
    const stored = phone === null ? null : phone === undefined ? undefined : e164(phone);
    if (stored === undefined || (phone !== null && stored === null)) return null;
    change.phone = stored;
  }
  if ('email' in body) {
    const email = text(body['email'], 254);
    if (email === undefined || (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      return null;
    change.email = email?.toLowerCase() ?? null;
  }
  if ('humanOnly' in body) {
    if (typeof body['humanOnly'] !== 'boolean') return null;
    change.humanOnly = body['humanOnly'];
  }
  return change;
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase();
const maskPhone = (p: string) => `${p.slice(0, 5)}*****${p.slice(-2)}`;
const maskEmail = (e: string) => `${e[0]}***${e.slice(e.indexOf('@'))}`;

/** Answers a route of /v1/customers and says true, or false for any other route; `session` is null when signed out. */
export async function routeCustomers(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  if (!path.startsWith('/v1/customers')) return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  const mine = edited.get(session.sid) ?? new Map<string, Customer>();
  const customers = CUSTOMERS.map((c) => mine.get(c.id) ?? c);
  const masked = session.role === 'marketing' || session.role === 'viewer';
  const shown = (c: Customer) => ({
    ...c,
    phone: c.phone && masked ? maskPhone(c.phone) : c.phone,
    email: c.email && masked ? maskEmail(c.email) : c.email,
  });
  // #8 Hồ sơ khách: one customer; another company's or none is a 404 (P9).
  const one = /^\/v1\/customers\/([^/]+)$/.exec(path);
  if (one) {
    const c = customers.find((x) => x.id === decodeURIComponent(one[1] ?? ''));
    if (req.method === 'PATCH') {
      // "Sửa hồ sơ khách" (Phụ lục B): not Marketing or Viewer; the answer is never masked.
      if (masked) return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
      const change = changeOf(await edge.json(req));
      if (!change) return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
      if (!c) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
      const next = { ...c, ...change, updatedAt: new Date().toISOString() };
      edited.set(session.sid, mine.set(c.id, next));
      return (edge.send(res, 200, next), true);
    }
    if (req.method !== 'GET') return false;
    if (!c) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
    return (edge.send(res, 200, shown(c)), true);
  }
  if (req.method !== 'GET' || path !== '/v1/customers') return false;
  const query = new URL(req.url ?? '/', 'http://stub').searchParams;
  const q = query.get('q')?.trim() ?? '';
  const digits = q.replace(/\D/g, '');
  const prefix = !masked && /^[\d\s+.-]+$/.test(q) && digits.length >= 3 ? digits : null;
  const found = customers.filter((c) =>
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
