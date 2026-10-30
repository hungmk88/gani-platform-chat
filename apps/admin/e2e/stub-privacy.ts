// #23 Dữ liệu khách for the e2e stub API only: `GET /v1/privacy-requests` as planned (docs/openapi/planned.json, N167), read by
// Owner and Admin, in two pages; the second repeats the last row of the first, as a request recorded between the two would make
// it. The empty list, errors and the 404 are given by the tests with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PrivacyRequest } from '../src/privacy/privacy';
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
export const REQUEST_PAGES = [
  { data: REQUESTS.slice(0, 2), nextCursor: 'trang-2' },
  { data: REQUESTS.slice(1), nextCursor: null },
];

/** Answers GET /v1/privacy-requests and says true, or says false for any other route. `session` is null when signed out. */
export function routePrivacy(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || path !== '/v1/privacy-requests') return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const cursor = new URL(req.url ?? '/', 'http://stub').searchParams.get('cursor');
  edge.send(res, 200, REQUEST_PAGES[cursor === 'trang-2' ? 1 : 0]);
  return true;
}
