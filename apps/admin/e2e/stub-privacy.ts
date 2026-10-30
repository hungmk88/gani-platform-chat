// #23 Dữ liệu khách for the e2e stub API only, as planned (docs/openapi/planned.json, N167), Owner and Admin: `GET
// /v1/privacy-requests` in two pages (the second repeats the last row of the first, as a request recorded between the two would
// make it); `POST` records a request in the session's copy (a customer of CUSTOMERS, 404 otherwise; 409 when one of the same kind
// waits). Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PrivacyRequest, PrivacyRequestPage as PrivacyPage } from '../src/privacy/privacy';
import { CUSTOMERS } from './stub-customers';
import type { Edge } from './stub-members';

const id = (n: number) => `0190f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const by = { id: id(900), name: 'Nguyễn An' };

const request = (
  n: number,
  kind: PrivacyRequest['kind'],
  status: PrivacyRequest['status'],
  displayName: string | null,
  reason: string,
): PrivacyRequest => ({
  id: id(n),
  kind,
  status,
  customer: { id: id(100 + n), displayName },
  reason,
  requestedBy: by,
  createdAt: `2026-10-2${9 - n}T17:30:00.000Z`,
  executedAt: status === 'pending' ? null : `2026-10-2${9 - n}T18:00:00.000Z`,
});

const REQUESTS = [
  request(1, 'erase', 'pending', 'Trần Bình', 'Khách gọi tổng đài xin xóa hồ sơ.'),
  request(2, 'export', 'done', null, 'Khách xin bản sao dữ liệu qua Zalo.'),
  request(3, 'erase', 'failed', 'Lê Châu', 'Xin xóa sau khi ngừng mua hàng.'),
];
export const REQUEST_PAGES: readonly [PrivacyPage, PrivacyPage] = [
  { data: REQUESTS.slice(0, 2), nextCursor: 'trang-2' },
  { data: REQUESTS.slice(1), nextCursor: null },
];

const copies = new Map<string, PrivacyRequest[]>(); // session → the requests it recorded

/** Answers the routes of #23 and says true, or says false for any other route. `session` is null when signed out. */
export async function routePrivacy(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly sid: string; readonly role: string | undefined } | null,
  edge: Edge,
): Promise<boolean> {
  if (path !== '/v1/privacy-requests' || (req.method !== 'GET' && req.method !== 'POST'))
    return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const added = copies.get(session.sid) ?? [];
  copies.set(session.sid, added);
  if (req.method === 'GET') {
    const cursor = new URL(req.url ?? '/', 'http://stub').searchParams.get('cursor');
    const page = REQUEST_PAGES[cursor === 'trang-2' ? 1 : 0];
    return (edge.send(res, 200, { ...page, data: [...(cursor ? [] : added), ...page.data] }), true);
  }
  const { customerId, kind, reason } = await edge.json(req);
  const customer = CUSTOMERS.find((c) => c.id === customerId);
  if ((kind !== 'export' && kind !== 'erase') || typeof reason !== 'string' || !reason.trim())
    return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  if (!customer) return (edge.problem(res, 404, 'not_found', 'trace-e2e-404'), true);
  const waiting = [...added, ...REQUESTS].some(
    (r) => r.customer.id === customerId && r.kind === kind && r.status === 'pending',
  );
  if (waiting) return (edge.problem(res, 409, 'duplicate_resource', 'trace-e2e-409'), true);
  const made: PrivacyRequest = {
    id: id(200 + added.length),
    kind,
    status: 'pending',
    customer: { id: customer.id, displayName: customer.displayName },
    reason,
    requestedBy: by,
    createdAt: '2026-10-30T08:00:00.000Z',
    executedAt: null,
  };
  added.unshift(made);
  return (edge.send(res, 201, made), true);
}
