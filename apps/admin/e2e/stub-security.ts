// #29 Bảo mật for the e2e stub API only: `GET /v1/security-incidents?status=` and `GET /v1/security-alerts` as planned
// (docs/openapi/planned.json, N167), read by Owner and Admin. The alerts come in two pages and the second repeats the last row of
// the first, as a new alert put at the head between the two would make it. Empty lists, errors and the 404 are given by the tests
// with page.route. Never deployed.
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SecurityAlert, SecurityIncident } from '../src/security/security';
import type { Edge } from './stub-members';

const id = (n: number) => `0190e000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const person = (n: number, name: string) => ({ id: id(900 + n), name });

export const INCIDENTS: readonly SecurityIncident[] = [
  {
    id: id(1),
    title: 'Đăng nhập sai liên tục vào tài khoản Admin',
    severity: 'high',
    status: 'open',
    handler: person(1, 'Nguyễn An'),
    openedBy: person(2, 'Trần Bình'),
    alertIds: [id(11)],
    openedAt: '2026-10-29T17:30:00.000Z',
    closedAt: null,
  },
  {
    id: id(2),
    title: 'Chữ ký webhook Zalo sai nhiều lần',
    severity: 'critical',
    status: 'open',
    handler: person(2, 'Trần Bình'),
    openedBy: person(2, 'Trần Bình'),
    alertIds: [],
    openedAt: '2026-10-28T02:00:00.000Z',
    closedAt: null,
  },
  {
    id: id(3),
    title: 'Xuất danh sách khách ngoài giờ',
    severity: 'medium',
    status: 'closed',
    handler: person(1, 'Nguyễn An'),
    openedBy: person(1, 'Nguyễn An'),
    alertIds: [],
    openedAt: '2026-10-20T02:00:00.000Z',
    closedAt: '2026-10-21T03:15:00.000Z',
  },
];

const alert = (
  n: number,
  kind: SecurityAlert['kind'],
  severity: SecurityAlert['severity'],
  count: number,
  incident: number | null,
): SecurityAlert => ({
  id: id(10 + n),
  kind,
  severity,
  occurredAt: `2026-10-2${9 - n}T17:30:00.000Z`,
  subjectUserId: null,
  channelAccountId: null,
  count,
  incidentId: incident ? id(incident) : null,
});

const ALERTS = [
  alert(1, 'login_failures', 'high', 12, 1),
  alert(2, 'platform_access', 'low', 1, null),
  alert(3, 'bulk_export', 'medium', 1, null),
];
export const ALERT_PAGES = [
  { data: ALERTS.slice(0, 2), nextCursor: 'trang-2' },
  { data: ALERTS.slice(1), nextCursor: null },
];

/** Answers the two GETs of #29 and says true, or says false for any other route. `session` is null when signed out. */
export function routeSecurity(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  session: { readonly role: string | undefined } | null,
  edge: Edge,
): boolean {
  if (req.method !== 'GET' || !['/v1/security-incidents', '/v1/security-alerts'].includes(path))
    return false;
  if (!session) return (edge.problem(res, 401, 'unauthorized', 'trace-e2e-401'), true);
  if (session.role !== 'owner' && session.role !== 'admin')
    return (edge.problem(res, 403, 'forbidden', 'trace-e2e-403'), true);
  const q = new URL(req.url ?? '/', 'http://stub').searchParams;
  if (path === '/v1/security-alerts')
    return (edge.send(res, 200, ALERT_PAGES[q.get('cursor') === 'trang-2' ? 1 : 0]), true);
  const status = q.get('status');
  if (status !== 'open' && status !== 'closed')
    return (edge.problem(res, 400, 'validation_failed', 'trace-e2e-400'), true);
  edge.send(res, 200, { data: INCIDENTS.filter((i) => i.status === status), nextCursor: null });
  return true;
}
